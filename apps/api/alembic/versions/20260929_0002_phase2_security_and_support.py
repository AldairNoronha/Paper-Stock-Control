"""Add Phase 2 security, idempotency, reasons and audit support.

Revision ID: 20260929_0002
Revises: 20260929_0001
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260929_0002"
down_revision: str | None = "20260929_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "materials",
        sa.Column("rotation_policy", sa.String(length=8), server_default="FIFO", nullable=False),
    )
    op.create_check_constraint(
        op.f("ck_materials_valid_rotation_policy"),
        "materials",
        "rotation_policy IN ('FIFO', 'FEFO')",
    )

    op.create_table(
        "user_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_profiles")),
    )
    op.create_table(
        "roles",
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_roles")),
        sa.UniqueConstraint("code", name=op.f("uq_roles_code")),
    )
    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("role_id", sa.Uuid(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["role_id"],
            ["roles.id"],
            name=op.f("fk_user_roles_role_id_roles"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["user_profiles.id"],
            name=op.f("fk_user_roles_user_id_user_profiles"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_roles")),
        sa.UniqueConstraint("user_id", "role_id", name="uq_user_roles_user_role"),
    )
    op.create_index(op.f("ix_user_roles_role_id"), "user_roles", ["role_id"])
    op.create_index(op.f("ix_user_roles_user_id"), "user_roles", ["user_id"])

    op.create_table(
        "reason_codes",
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_reason_codes")),
        sa.UniqueConstraint("code", name=op.f("uq_reason_codes_code")),
    )
    op.create_index(op.f("ix_reason_codes_category"), "reason_codes", ["category"])
    op.create_foreign_key(
        "fk_inventory_movements_reason_code_reason_codes",
        "inventory_movements",
        "reason_codes",
        ["reason_code"],
        ["code"],
        ondelete="RESTRICT",
    )

    op.drop_constraint(
        op.f("ck_inventory_movements_valid_movement_shape"),
        "inventory_movements",
        type_="check",
    )
    op.create_check_constraint(
        op.f("ck_inventory_movements_valid_movement_shape"),
        "inventory_movements",
        "(movement_type IN ('TRANSFER', 'REVERSAL') AND quantity IS NULL "
        "AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL) "
        "OR (movement_type <> 'TRANSFER' AND quantity IS NOT NULL AND quantity > 0)",
    )

    op.create_table(
        "idempotency_records",
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("operation_scope", sa.String(length=80), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("request_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("resource_type", sa.String(length=80), nullable=True),
        sa.Column("resource_id", sa.Uuid(), nullable=True),
        sa.Column("response_body", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_idempotency_records")),
        sa.UniqueConstraint(
            "actor_id",
            "operation_scope",
            "idempotency_key",
            name="uq_idempotency_records_command",
        ),
    )

    op.create_table(
        "audit_logs",
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("action", sa.String(length=80), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=False),
        sa.Column("entity_id", sa.Uuid(), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="{}",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_audit_logs")),
    )
    op.create_index(op.f("ix_audit_logs_action"), "audit_logs", ["action"])
    op.create_index(op.f("ix_audit_logs_actor_id"), "audit_logs", ["actor_id"])
    op.create_index(op.f("ix_audit_logs_entity_id"), "audit_logs", ["entity_id"])
    op.execute(
        """
        CREATE FUNCTION prevent_audit_log_mutation()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'audit logs are append-only';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER audit_logs_append_only
        BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation()
        """
    )

    roles = sa.table(
        "roles",
        sa.column("id", sa.Uuid()),
        sa.column("code", sa.String()),
        sa.column("name", sa.String()),
    )
    op.bulk_insert(
        roles,
        [
            {"id": "0199a953-b7d1-7000-8000-000000000001", "code": "OPERATOR", "name": "Operador"},
            {"id": "0199a953-b7d1-7000-8000-000000000002", "code": "QUALITY", "name": "Qualidade"},
            {"id": "0199a953-b7d1-7000-8000-000000000003", "code": "SUPERVISOR", "name": "Supervisor"},
            {"id": "0199a953-b7d1-7000-8000-000000000004", "code": "PCP", "name": "PCP / Administrativo"},
            {"id": "0199a953-b7d1-7000-8000-000000000005", "code": "ADMIN", "name": "Administrador"},
            {"id": "0199a953-b7d1-7000-8000-000000000006", "code": "VIEWER", "name": "Consulta"},
        ],
    )
    reasons = sa.table(
        "reason_codes",
        sa.column("id", sa.Uuid()),
        sa.column("code", sa.String()),
        sa.column("category", sa.String()),
        sa.column("label", sa.String()),
    )
    op.bulk_insert(
        reasons,
        [
            {"id": "0199a953-b7d2-7000-8000-000000000001", "code": "QUALITY_HOLD", "category": "BLOCK", "label": "Bloqueio da qualidade"},
            {"id": "0199a953-b7d2-7000-8000-000000000002", "code": "QUALITY_RELEASE", "category": "UNBLOCK", "label": "Liberação da qualidade"},
            {"id": "0199a953-b7d2-7000-8000-000000000003", "code": "DAMAGED", "category": "DISCARD", "label": "Material danificado"},
            {"id": "0199a953-b7d2-7000-8000-000000000004", "code": "FIFO_OVERRIDE", "category": "ISSUE", "label": "Saída fora da rotação"},
            {"id": "0199a953-b7d2-7000-8000-000000000005", "code": "OPERATIONAL_RETURN", "category": "RETURN", "label": "Retorno da produção"},
            {"id": "0199a953-b7d2-7000-8000-000000000006", "code": "AUTHORIZED_REVERSAL", "category": "REVERSAL", "label": "Estorno autorizado"},
        ],
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER audit_logs_append_only ON audit_logs")
    op.execute("DROP FUNCTION prevent_audit_log_mutation()")
    op.drop_index(op.f("ix_audit_logs_entity_id"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_actor_id"), table_name="audit_logs")
    op.drop_index(op.f("ix_audit_logs_action"), table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_table("idempotency_records")
    op.drop_constraint(
        op.f("ck_inventory_movements_valid_movement_shape"),
        "inventory_movements",
        type_="check",
    )
    # Phase 1 cannot represent a transfer reversal as REVERSAL. Preserve the
    # inverse transfer in the ledger while removing only the Phase 2 marker.
    op.execute("DROP TRIGGER inventory_movements_append_only ON inventory_movements")
    op.execute(
        "UPDATE inventory_movements SET movement_type = 'TRANSFER' "
        "WHERE movement_type = 'REVERSAL' AND quantity IS NULL"
    )
    op.execute(
        """
        CREATE TRIGGER inventory_movements_append_only
        BEFORE UPDATE OR DELETE ON inventory_movements
        FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation()
        """
    )
    op.create_check_constraint(
        op.f("ck_inventory_movements_valid_movement_shape"),
        "inventory_movements",
        "(movement_type = 'TRANSFER' AND quantity IS NULL "
        "AND from_location_id IS NOT NULL AND to_location_id IS NOT NULL) "
        "OR (movement_type <> 'TRANSFER' AND quantity IS NOT NULL AND quantity > 0)",
    )
    op.drop_constraint(
        "fk_inventory_movements_reason_code_reason_codes",
        "inventory_movements",
        type_="foreignkey",
    )
    op.drop_index(op.f("ix_reason_codes_category"), table_name="reason_codes")
    op.drop_table("reason_codes")
    op.drop_index(op.f("ix_user_roles_user_id"), table_name="user_roles")
    op.drop_index(op.f("ix_user_roles_role_id"), table_name="user_roles")
    op.drop_table("user_roles")
    op.drop_table("roles")
    op.drop_table("user_profiles")
    op.drop_constraint(op.f("ck_materials_valid_rotation_policy"), "materials", type_="check")
    op.drop_column("materials", "rotation_policy")
