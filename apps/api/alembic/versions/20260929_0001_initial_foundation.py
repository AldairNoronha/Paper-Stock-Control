"""Create the initial Paper Stock Control foundation.

Revision ID: 20260929_0001
Revises: None
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260929_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "suppliers",
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_suppliers")),
        sa.UniqueConstraint("code", name=op.f("uq_suppliers_code")),
        sa.UniqueConstraint("name", name=op.f("uq_suppliers_name")),
    )
    op.create_table(
        "materials",
        sa.Column("internal_code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("width_mm", sa.Integer(), nullable=False),
        sa.Column("length_mm", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("length_mm > 0", name=op.f("ck_materials_positive_length")),
        sa.CheckConstraint("width_mm > 0", name=op.f("ck_materials_positive_width")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_materials")),
        sa.UniqueConstraint("internal_code", name=op.f("uq_materials_internal_code")),
    )
    op.create_table(
        "locations",
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_locations")),
        sa.UniqueConstraint("code", name=op.f("uq_locations_code")),
    )
    op.create_table(
        "supplier_materials",
        sa.Column("supplier_id", sa.Uuid(), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=False),
        sa.Column("supplier_code", sa.String(length=80), nullable=True),
        sa.Column("supplier_name", sa.String(length=240), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["material_id"], ["materials.id"], name=op.f("fk_supplier_materials_material_id_materials"), ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["supplier_id"], ["suppliers.id"], name=op.f("fk_supplier_materials_supplier_id_suppliers"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_supplier_materials")),
        sa.UniqueConstraint("supplier_id", "supplier_code", name="uq_supplier_materials_supplier_code"),
        sa.UniqueConstraint("supplier_id", "supplier_name", name="uq_supplier_materials_supplier_name"),
    )
    op.create_index(op.f("ix_supplier_materials_material_id"), "supplier_materials", ["material_id"])
    op.create_index(op.f("ix_supplier_materials_supplier_id"), "supplier_materials", ["supplier_id"])
    op.create_table(
        "pallets",
        sa.Column("internal_number", sa.BigInteger(), sa.Identity(start=1), nullable=False),
        sa.Column("supplier_id", sa.Uuid(), nullable=False),
        sa.Column("material_id", sa.Uuid(), nullable=False),
        sa.Column("location_id", sa.Uuid(), nullable=False),
        sa.Column("supplier_material_name", sa.String(length=240), nullable=False),
        sa.Column("supplier_pallet_code", sa.String(length=120), nullable=True),
        sa.Column("supplier_sscc", sa.String(length=18), nullable=True),
        sa.Column("lot_code", sa.String(length=120), nullable=True),
        sa.Column("received_quantity", sa.Integer(), nullable=False),
        sa.Column("available_quantity", sa.Integer(), nullable=False),
        sa.Column("blocked_quantity", sa.Integer(), server_default="0", nullable=False),
        sa.Column("consumed_quantity", sa.Integer(), server_default="0", nullable=False),
        sa.Column("discarded_quantity", sa.Integer(), server_default="0", nullable=False),
        sa.Column("net_adjustment_quantity", sa.Integer(), server_default="0", nullable=False),
        sa.Column("width_mm", sa.Integer(), nullable=False),
        sa.Column("length_mm", sa.Integer(), nullable=False),
        sa.Column("declared_area_m2", sa.Numeric(precision=14, scale=3), nullable=True),
        sa.Column("manufactured_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_on", sa.Date(), nullable=True),
        sa.Column("orientation", sa.String(length=32), nullable=True),
        sa.Column("lifecycle_status", sa.String(length=16), server_default="ACTIVE", nullable=False),
        sa.Column("raw_label_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("available_quantity >= 0", name=op.f("ck_pallets_available_nonnegative")),
        sa.CheckConstraint("blocked_quantity >= 0", name=op.f("ck_pallets_blocked_nonnegative")),
        sa.CheckConstraint("consumed_quantity >= 0", name=op.f("ck_pallets_consumed_nonnegative")),
        sa.CheckConstraint("discarded_quantity >= 0", name=op.f("ck_pallets_discarded_nonnegative")),
        sa.CheckConstraint("length_mm > 0", name=op.f("ck_pallets_positive_length")),
        sa.CheckConstraint("received_quantity >= 0", name=op.f("ck_pallets_received_nonnegative")),
        sa.CheckConstraint("supplier_sscc IS NULL OR supplier_sscc ~ '^[0-9]{18}$'", name=op.f("ck_pallets_valid_sscc")),
        sa.CheckConstraint("width_mm > 0", name=op.f("ck_pallets_positive_width")),
        sa.CheckConstraint(
            "available_quantity + blocked_quantity + consumed_quantity + discarded_quantity = received_quantity + net_adjustment_quantity",
            name=op.f("ck_pallets_quantity_conservation"),
        ),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], name=op.f("fk_pallets_location_id_locations"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["material_id"], ["materials.id"], name=op.f("fk_pallets_material_id_materials"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], name=op.f("fk_pallets_supplier_id_suppliers"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_pallets")),
        sa.UniqueConstraint("internal_number", name=op.f("uq_pallets_internal_number")),
    )
    op.create_index(op.f("ix_pallets_location_id"), "pallets", ["location_id"])
    op.create_index(op.f("ix_pallets_material_id"), "pallets", ["material_id"])
    op.create_index(op.f("ix_pallets_supplier_id"), "pallets", ["supplier_id"])
    op.create_index(
        "uq_pallets_supplier_sscc",
        "pallets",
        ["supplier_id", "supplier_sscc"],
        unique=True,
        postgresql_where=sa.text("supplier_sscc IS NOT NULL"),
    )
    op.create_index(
        "uq_pallets_supplier_pallet_code",
        "pallets",
        ["supplier_id", "supplier_pallet_code"],
        unique=True,
        postgresql_where=sa.text("supplier_pallet_code IS NOT NULL"),
    )
    op.create_table(
        "inventory_movements",
        sa.Column("pallet_id", sa.Uuid(), nullable=False),
        sa.Column("movement_type", sa.String(length=32), nullable=False),
        sa.Column("from_bucket", sa.String(length=16), nullable=True),
        sa.Column("to_bucket", sa.String(length=16), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=True),
        sa.Column("from_location_id", sa.Uuid(), nullable=True),
        sa.Column("to_location_id", sa.Uuid(), nullable=True),
        sa.Column("source_movement_id", sa.Uuid(), nullable=True),
        sa.Column("reason_code", sa.String(length=64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("destination_reference", sa.String(length=160), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint("from_location_id IS NULL OR to_location_id IS NULL OR from_location_id <> to_location_id", name=op.f("ck_inventory_movements_different_locations")),
        sa.CheckConstraint("(movement_type = 'TRANSFER' AND quantity IS NULL AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL) OR (movement_type <> 'TRANSFER' AND quantity IS NOT NULL AND quantity > 0)", name=op.f("ck_inventory_movements_valid_movement_shape")),
        sa.ForeignKeyConstraint(["from_location_id"], ["locations.id"], name=op.f("fk_inventory_movements_from_location_id_locations"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["pallet_id"], ["pallets.id"], name=op.f("fk_inventory_movements_pallet_id_pallets"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_movement_id"], ["inventory_movements.id"], name=op.f("fk_inventory_movements_source_movement_id_inventory_movements"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["to_location_id"], ["locations.id"], name=op.f("fk_inventory_movements_to_location_id_locations"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_inventory_movements")),
        sa.UniqueConstraint("idempotency_key", name=op.f("uq_inventory_movements_idempotency_key")),
        sa.UniqueConstraint("source_movement_id", name=op.f("uq_inventory_movements_source_movement_id")),
    )
    op.create_index(op.f("ix_inventory_movements_pallet_id"), "inventory_movements", ["pallet_id"])
    op.execute(
        """
        CREATE FUNCTION prevent_inventory_movement_mutation()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'inventory movements are append-only';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER inventory_movements_append_only
        BEFORE UPDATE OR DELETE ON inventory_movements
        FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation()
        """
    )
    op.create_table(
        "label_scans",
        sa.Column("image_path", sa.String(length=512), nullable=False),
        sa.Column("image_sha256", sa.String(length=64), nullable=True),
        sa.Column("status", sa.String(length=24), server_default="UPLOADED", nullable=False),
        sa.Column("supplier_detected_id", sa.Uuid(), nullable=True),
        sa.Column("supplier_confidence", sa.Numeric(precision=5, scale=4), nullable=True),
        sa.Column("ocr_raw_text", sa.Text(), nullable=True),
        sa.Column("qr_raw_value", sa.Text(), nullable=True),
        sa.Column("barcode_raw_values", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("raw_payload_sha256", sa.String(length=64), nullable=True),
        sa.Column("parser_name", sa.String(length=120), nullable=True),
        sa.Column("parser_version", sa.String(length=32), nullable=True),
        sa.Column("overall_confidence", sa.Numeric(precision=5, scale=4), nullable=True),
        sa.Column("pallet_id", sa.Uuid(), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["pallet_id"], ["pallets.id"], name=op.f("fk_label_scans_pallet_id_pallets"), ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["supplier_detected_id"], ["suppliers.id"], name=op.f("fk_label_scans_supplier_detected_id_suppliers"), ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_label_scans")),
        sa.UniqueConstraint("image_path", name=op.f("uq_label_scans_image_path")),
        sa.UniqueConstraint("pallet_id", name=op.f("uq_label_scans_pallet_id")),
    )
    op.create_index(op.f("ix_label_scans_image_sha256"), "label_scans", ["image_sha256"])
    op.create_index(op.f("ix_label_scans_raw_payload_sha256"), "label_scans", ["raw_payload_sha256"])
    op.create_table(
        "label_field_readings",
        sa.Column("label_scan_id", sa.Uuid(), nullable=False),
        sa.Column("field_name", sa.String(length=80), nullable=False),
        sa.Column("normalized_value", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("confidence", sa.Numeric(precision=5, scale=4), nullable=True),
        sa.Column("evidence", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("was_corrected", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("correction_reason", sa.String(length=240), nullable=True),
        sa.Column("corrected_by", sa.Uuid(), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["label_scan_id"], ["label_scans.id"], name=op.f("fk_label_field_readings_label_scan_id_label_scans"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_label_field_readings")),
    )
    op.create_index(op.f("ix_label_field_readings_label_scan_id"), "label_field_readings", ["label_scan_id"])

    suppliers = sa.table(
        "suppliers",
        sa.column("id", sa.Uuid()),
        sa.column("code", sa.String()),
        sa.column("name", sa.String()),
    )
    op.bulk_insert(
        suppliers,
        [
            {"id": "0199a953-b7d0-7000-8000-000000000001", "code": "IMPRESS", "name": "Impress"},
            {"id": "0199a953-b7d0-7000-8000-000000000002", "code": "SCHATTDECOR", "name": "Schattdecor"},
            {"id": "0199a953-b7d0-7000-8000-000000000003", "code": "INTERPRINT", "name": "Interprint"},
        ],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_label_field_readings_label_scan_id"), table_name="label_field_readings")
    op.drop_table("label_field_readings")
    op.drop_index(op.f("ix_label_scans_raw_payload_sha256"), table_name="label_scans")
    op.drop_index(op.f("ix_label_scans_image_sha256"), table_name="label_scans")
    op.drop_table("label_scans")
    op.execute("DROP TRIGGER inventory_movements_append_only ON inventory_movements")
    op.execute("DROP FUNCTION prevent_inventory_movement_mutation()")
    op.drop_index(op.f("ix_inventory_movements_pallet_id"), table_name="inventory_movements")
    op.drop_table("inventory_movements")
    op.drop_index("uq_pallets_supplier_pallet_code", table_name="pallets")
    op.drop_index("uq_pallets_supplier_sscc", table_name="pallets")
    op.drop_index(op.f("ix_pallets_supplier_id"), table_name="pallets")
    op.drop_index(op.f("ix_pallets_material_id"), table_name="pallets")
    op.drop_index(op.f("ix_pallets_location_id"), table_name="pallets")
    op.drop_table("pallets")
    op.drop_index(op.f("ix_supplier_materials_supplier_id"), table_name="supplier_materials")
    op.drop_index(op.f("ix_supplier_materials_material_id"), table_name="supplier_materials")
    op.drop_table("supplier_materials")
    op.drop_table("locations")
    op.drop_table("materials")
    op.drop_table("suppliers")
