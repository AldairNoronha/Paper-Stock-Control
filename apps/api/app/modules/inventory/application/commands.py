from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(UTC)


class ReceiptCommand(BaseModel):
    supplier_id: UUID
    material_id: UUID
    location_id: UUID
    supplier_material_name: str = Field(min_length=1, max_length=240)
    supplier_pallet_code: str | None = Field(default=None, max_length=120)
    supplier_sscc: str | None = Field(default=None, pattern=r"^[0-9]{18}$")
    lot_code: str | None = Field(default=None, max_length=120)
    quantity_sheets: int = Field(gt=0)
    width_mm: int = Field(gt=0)
    length_mm: int = Field(gt=0)
    declared_area_m2: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=3)
    manufactured_at: datetime | None = None
    expires_on: date | None = None
    orientation: str | None = Field(default=None, max_length=32)
    raw_label_payload: dict[str, object] | None = None
    label_scan_id: UUID | None = None
    occurred_at: datetime = Field(default_factory=utc_now)

    @field_validator("supplier_pallet_code", "lot_code", "orientation")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class QuantityMovementCommand(BaseModel):
    quantity_sheets: int = Field(gt=0)
    reason_code: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=2000)
    destination_reference: str | None = Field(default=None, max_length=160)
    occurred_at: datetime = Field(default_factory=utc_now)


class IssueCommand(QuantityMovementCommand):
    destination_reference: str = Field(min_length=1, max_length=160)


class RequiredReasonMovementCommand(QuantityMovementCommand):
    reason_code: str = Field(min_length=1, max_length=64)


class DiscardCommand(RequiredReasonMovementCommand):
    source_bucket: Literal["AVAILABLE", "BLOCKED"]


class TransferCommand(BaseModel):
    to_location_id: UUID
    reason_code: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=2000)
    occurred_at: datetime = Field(default_factory=utc_now)


class ReversalCommand(BaseModel):
    reason_code: str = Field(min_length=1, max_length=64)
    notes: str = Field(min_length=1, max_length=2000)
    occurred_at: datetime = Field(default_factory=utc_now)
