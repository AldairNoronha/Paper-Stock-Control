from app.db import model_registry  # noqa: F401
from app.db.base import Base


def test_expected_tables_are_registered() -> None:
    assert {
        "audit_logs",
        "idempotency_records",
        "inventory_movements",
        "label_field_readings",
        "label_scan_captures",
        "label_scans",
        "locations",
        "materials",
        "pallets",
        "reason_codes",
        "roles",
        "supplier_materials",
        "suppliers",
        "user_profiles",
        "user_roles",
    }.issubset(Base.metadata.tables)
