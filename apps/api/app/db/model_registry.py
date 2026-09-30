"""Import every ORM model so Alembic can discover the complete metadata."""

from app.modules.audit.domain.models import AuditLog
from app.modules.catalog.domain.models import Material, Supplier, SupplierMaterial
from app.modules.identity.domain.models import Role, UserProfile, UserRole
from app.modules.inventory.domain.models import InventoryMovement, Pallet
from app.modules.inventory.domain.support_models import IdempotencyRecord, ReasonCode
from app.modules.labels.domain.models import LabelFieldReading, LabelScan, LabelScanCapture
from app.modules.locations.domain.models import Location

__all__ = [
    "AuditLog",
    "IdempotencyRecord",
    "InventoryMovement",
    "LabelFieldReading",
    "LabelScan",
    "LabelScanCapture",
    "Location",
    "Material",
    "Pallet",
    "ReasonCode",
    "Role",
    "Supplier",
    "SupplierMaterial",
    "UserProfile",
    "UserRole",
]
