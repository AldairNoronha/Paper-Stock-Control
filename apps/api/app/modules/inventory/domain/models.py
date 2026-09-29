from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Identity,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.ids import format_internal_qr, format_pallet_code
from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.modules.catalog.domain.models import Material, Supplier
from app.modules.locations.domain.models import Location


def enum_values(enum_class: type[StrEnum]) -> list[str]:
    return [item.value for item in enum_class]


class PalletLifecycleStatus(StrEnum):
    ACTIVE = "ACTIVE"
    DEPLETED = "DEPLETED"
    CANCELLED = "CANCELLED"


class StockBucket(StrEnum):
    EXTERNAL = "EXTERNAL"
    AVAILABLE = "AVAILABLE"
    BLOCKED = "BLOCKED"
    CONSUMED = "CONSUMED"
    DISCARDED = "DISCARDED"


class MovementType(StrEnum):
    RECEIPT = "RECEIPT"
    ISSUE = "ISSUE"
    BLOCK = "BLOCK"
    UNBLOCK = "UNBLOCK"
    DISCARD_AVAILABLE = "DISCARD_AVAILABLE"
    DISCARD_BLOCKED = "DISCARD_BLOCKED"
    RETURN = "RETURN"
    TRANSFER = "TRANSFER"
    ADJUSTMENT_IN = "ADJUSTMENT_IN"
    ADJUSTMENT_OUT = "ADJUSTMENT_OUT"
    REVERSAL = "REVERSAL"


class Pallet(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "pallets"
    __table_args__ = (
        CheckConstraint("received_quantity >= 0", name="received_nonnegative"),
        CheckConstraint("available_quantity >= 0", name="available_nonnegative"),
        CheckConstraint("blocked_quantity >= 0", name="blocked_nonnegative"),
        CheckConstraint("consumed_quantity >= 0", name="consumed_nonnegative"),
        CheckConstraint("discarded_quantity >= 0", name="discarded_nonnegative"),
        CheckConstraint("width_mm > 0", name="positive_width"),
        CheckConstraint("length_mm > 0", name="positive_length"),
        CheckConstraint(
            "supplier_sscc IS NULL OR supplier_sscc ~ '^[0-9]{18}$'",
            name="valid_sscc",
        ),
        CheckConstraint(
            "available_quantity + blocked_quantity + consumed_quantity + discarded_quantity "
            "= received_quantity + net_adjustment_quantity",
            name="quantity_conservation",
        ),
        Index(
            "uq_pallets_supplier_sscc",
            "supplier_id",
            "supplier_sscc",
            unique=True,
            postgresql_where=text("supplier_sscc IS NOT NULL"),
        ),
        Index(
            "uq_pallets_supplier_pallet_code",
            "supplier_id",
            "supplier_pallet_code",
            unique=True,
            postgresql_where=text("supplier_pallet_code IS NOT NULL"),
        ),
    )

    internal_number: Mapped[int] = mapped_column(
        BigInteger, Identity(start=1), unique=True, nullable=False
    )
    supplier_id: Mapped[UUID] = mapped_column(
        ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    material_id: Mapped[UUID] = mapped_column(
        ForeignKey("materials.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    location_id: Mapped[UUID] = mapped_column(
        ForeignKey("locations.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    supplier_material_name: Mapped[str] = mapped_column(String(240), nullable=False)
    supplier_pallet_code: Mapped[str | None] = mapped_column(String(120))
    supplier_sscc: Mapped[str | None] = mapped_column(String(18))
    lot_code: Mapped[str | None] = mapped_column(String(120))
    received_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    available_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    blocked_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    consumed_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    discarded_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    net_adjustment_quantity: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    width_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    length_mm: Mapped[int] = mapped_column(Integer, nullable=False)
    declared_area_m2: Mapped[Decimal | None] = mapped_column(Numeric(14, 3))
    manufactured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_on: Mapped[date | None] = mapped_column(Date)
    orientation: Mapped[str | None] = mapped_column(String(32))
    lifecycle_status: Mapped[PalletLifecycleStatus] = mapped_column(
        Enum(
            PalletLifecycleStatus,
            values_callable=enum_values,
            native_enum=False,
            length=16,
        ),
        default=PalletLifecycleStatus.ACTIVE,
        nullable=False,
    )
    raw_label_payload: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    created_by: Mapped[UUID | None]
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    supplier: Mapped[Supplier] = relationship()
    material: Mapped[Material] = relationship()
    location: Mapped[Location] = relationship()

    @property
    def internal_code(self) -> str:
        return format_pallet_code(self.internal_number)

    @property
    def internal_qr(self) -> str:
        return format_internal_qr(self.id)


class InventoryMovement(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "inventory_movements"
    __table_args__ = (
        CheckConstraint(
            "(movement_type IN ('TRANSFER', 'REVERSAL') AND quantity IS NULL "
            "AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL) "
            "OR (movement_type <> 'TRANSFER' AND quantity IS NOT NULL AND quantity > 0)",
            name="valid_movement_shape",
        ),
        CheckConstraint(
            "from_location_id IS NULL OR to_location_id IS NULL "
            "OR from_location_id <> to_location_id",
            name="different_locations",
        ),
    )

    pallet_id: Mapped[UUID] = mapped_column(
        ForeignKey("pallets.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    movement_type: Mapped[MovementType] = mapped_column(
        Enum(MovementType, values_callable=enum_values, native_enum=False, length=32),
        nullable=False,
    )
    from_bucket: Mapped[StockBucket | None] = mapped_column(
        Enum(StockBucket, values_callable=enum_values, native_enum=False, length=16)
    )
    to_bucket: Mapped[StockBucket | None] = mapped_column(
        Enum(StockBucket, values_callable=enum_values, native_enum=False, length=16)
    )
    quantity: Mapped[int | None] = mapped_column(Integer)
    from_location_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("locations.id", ondelete="RESTRICT")
    )
    to_location_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("locations.id", ondelete="RESTRICT")
    )
    source_movement_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("inventory_movements.id", ondelete="RESTRICT"), unique=True
    )
    reason_code: Mapped[str | None] = mapped_column(
        ForeignKey("reason_codes.code", ondelete="RESTRICT"),
        nullable=True,
    )
    notes: Mapped[str | None] = mapped_column(Text)
    destination_reference: Mapped[str | None] = mapped_column(String(160))
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_by: Mapped[UUID] = mapped_column(nullable=False)

    pallet: Mapped[Pallet] = relationship()
