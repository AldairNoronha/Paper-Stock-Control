from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel

from app.modules.inventory.domain.models import InventoryMovement, Pallet


class PalletResponse(BaseModel):
    id: UUID
    internal_code: str
    internal_qr: str
    supplier_id: UUID
    material_id: UUID
    location_id: UUID
    supplier_material_name: str
    supplier_pallet_code: str | None
    supplier_sscc: str | None
    lot_code: str | None
    received_quantity: int
    available_quantity: int
    blocked_quantity: int
    consumed_quantity: int
    discarded_quantity: int
    width_mm: int
    length_mm: int
    declared_area_m2: Decimal | None
    manufactured_at: datetime | None
    expires_on: date | None
    orientation: str | None
    lifecycle_status: str
    version: int
    created_at: datetime

    @classmethod
    def from_domain(cls, pallet: Pallet) -> "PalletResponse":
        return cls(
            id=pallet.id,
            internal_code=pallet.internal_code,
            internal_qr=pallet.internal_qr,
            supplier_id=pallet.supplier_id,
            material_id=pallet.material_id,
            location_id=pallet.location_id,
            supplier_material_name=pallet.supplier_material_name,
            supplier_pallet_code=pallet.supplier_pallet_code,
            supplier_sscc=pallet.supplier_sscc,
            lot_code=pallet.lot_code,
            received_quantity=pallet.received_quantity,
            available_quantity=pallet.available_quantity,
            blocked_quantity=pallet.blocked_quantity,
            consumed_quantity=pallet.consumed_quantity,
            discarded_quantity=pallet.discarded_quantity,
            width_mm=pallet.width_mm,
            length_mm=pallet.length_mm,
            declared_area_m2=pallet.declared_area_m2,
            manufactured_at=pallet.manufactured_at,
            expires_on=pallet.expires_on,
            orientation=pallet.orientation,
            lifecycle_status=pallet.lifecycle_status.value,
            version=pallet.version,
            created_at=pallet.created_at,
        )


class MovementResponse(BaseModel):
    id: UUID
    pallet_id: UUID
    movement_type: str
    from_bucket: str | None
    to_bucket: str | None
    quantity: int | None
    from_location_id: UUID | None
    to_location_id: UUID | None
    source_movement_id: UUID | None
    reason_code: str | None
    notes: str | None
    destination_reference: str | None
    occurred_at: datetime
    created_at: datetime
    created_by: UUID

    @classmethod
    def from_domain(cls, movement: InventoryMovement) -> "MovementResponse":
        return cls(
            id=movement.id,
            pallet_id=movement.pallet_id,
            movement_type=movement.movement_type.value,
            from_bucket=movement.from_bucket.value if movement.from_bucket else None,
            to_bucket=movement.to_bucket.value if movement.to_bucket else None,
            quantity=movement.quantity,
            from_location_id=movement.from_location_id,
            to_location_id=movement.to_location_id,
            source_movement_id=movement.source_movement_id,
            reason_code=movement.reason_code,
            notes=movement.notes,
            destination_reference=movement.destination_reference,
            occurred_at=movement.occurred_at,
            created_at=movement.created_at,
            created_by=movement.created_by,
        )


class RotationRecommendationResponse(BaseModel):
    material_id: UUID
    recommended_pallet: PalletResponse | None
