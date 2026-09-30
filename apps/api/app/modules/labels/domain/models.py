from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.modules.catalog.domain.models import Supplier
from app.modules.inventory.domain.models import Pallet, enum_values


class LabelScanStatus(StrEnum):
    UPLOADED = "UPLOADED"
    PROCESSING = "PROCESSING"
    READY = "READY"
    NEEDS_REVIEW = "NEEDS_REVIEW"
    NEEDS_MAPPING = "NEEDS_MAPPING"
    REJECTED = "REJECTED"
    FAILED = "FAILED"
    CONFIRMED = "CONFIRMED"


class LabelScan(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "label_scans"
    __table_args__ = (
        Index(
            "uq_label_scans_image_sha256",
            "image_sha256",
            unique=True,
            postgresql_where=text("image_sha256 IS NOT NULL"),
        ),
    )

    image_path: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    image_sha256: Mapped[str | None] = mapped_column(String(64), index=True)
    status: Mapped[LabelScanStatus] = mapped_column(
        Enum(LabelScanStatus, values_callable=enum_values, native_enum=False, length=24),
        default=LabelScanStatus.UPLOADED,
        nullable=False,
    )
    supplier_detected_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="RESTRICT")
    )
    supplier_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    ocr_raw_text: Mapped[str | None] = mapped_column(Text)
    qr_raw_value: Mapped[str | None] = mapped_column(Text)
    barcode_raw_values: Mapped[list[str] | None] = mapped_column(JSONB)
    raw_payload_sha256: Mapped[str | None] = mapped_column(String(64), index=True)
    parser_name: Mapped[str | None] = mapped_column(String(120))
    parser_version: Mapped[str | None] = mapped_column(String(32))
    overall_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    pallet_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("pallets.id", ondelete="RESTRICT"), unique=True
    )
    created_by: Mapped[UUID] = mapped_column(nullable=False)

    supplier_detected: Mapped[Supplier | None] = relationship()
    pallet: Mapped[Pallet | None] = relationship()


class LabelFieldReading(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "label_field_readings"
    __table_args__ = (
        UniqueConstraint(
            "label_scan_id",
            "field_name",
            name="uq_label_field_readings_label_scan_field_name",
        ),
    )

    label_scan_id: Mapped[UUID] = mapped_column(
        ForeignKey("label_scans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field_name: Mapped[str] = mapped_column(String(80), nullable=False)
    normalized_value: Mapped[object | None] = mapped_column(JSONB)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    evidence: Mapped[list[dict[str, object]]] = mapped_column(JSONB, default=list, nullable=False)
    was_corrected: Mapped[bool] = mapped_column(default=False, nullable=False)
    correction_reason: Mapped[str | None] = mapped_column(String(240))
    corrected_by: Mapped[UUID | None]

    label_scan: Mapped[LabelScan] = relationship()


class LabelScanCapture(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "label_scan_captures"

    label_scan_id: Mapped[UUID] = mapped_column(
        ForeignKey("label_scans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target: Mapped[str] = mapped_column(String(32), nullable=False)
    field_names: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    image_path: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    image_sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    content_type: Mapped[str] = mapped_column(String(40), nullable=False)
    width: Mapped[int] = mapped_column(nullable=False)
    height: Mapped[int] = mapped_column(nullable=False)
    brightness: Mapped[Decimal] = mapped_column(Numeric(8, 3), nullable=False)
    contrast: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    sharpness: Mapped[Decimal] = mapped_column(Numeric(14, 3), nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    label_scan: Mapped[LabelScan] = relationship()
