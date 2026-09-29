from enum import StrEnum
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, Enum, ForeignKey, String, UniqueConstraint, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class RotationPolicy(StrEnum):
    FIFO = "FIFO"
    FEFO = "FEFO"


class Supplier(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "suppliers"

    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)


class Material(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "materials"
    __table_args__ = (
        CheckConstraint("width_mm > 0", name="positive_width"),
        CheckConstraint("length_mm > 0", name="positive_length"),
        CheckConstraint("rotation_policy IN ('FIFO', 'FEFO')", name="valid_rotation_policy"),
    )

    internal_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    width_mm: Mapped[int] = mapped_column(nullable=False)
    length_mm: Mapped[int] = mapped_column(nullable=False)
    rotation_policy: Mapped[RotationPolicy] = mapped_column(
        Enum(RotationPolicy, native_enum=False, length=8),
        default=RotationPolicy.FIFO,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)


class SupplierMaterial(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "supplier_materials"
    __table_args__ = (
        UniqueConstraint("supplier_id", "supplier_code", name="supplier_code"),
        UniqueConstraint("supplier_id", "supplier_name", name="supplier_name"),
    )

    supplier_id: Mapped[UUID] = mapped_column(
        ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    material_id: Mapped[UUID] = mapped_column(
        ForeignKey("materials.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    supplier_code: Mapped[str | None] = mapped_column(String(80))
    supplier_name: Mapped[str] = mapped_column(String(240), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=true(), nullable=False)

    supplier: Mapped[Supplier] = relationship()
    material: Mapped[Material] = relationship()
