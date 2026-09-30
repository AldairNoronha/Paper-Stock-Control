"""Store selected evidence captures from guided mobile scanning.

Revision ID: 20260930_0004
Revises: 20260930_0003
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260930_0004"
down_revision: str | None = "20260930_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "label_scan_captures",
        sa.Column("label_scan_id", sa.Uuid(), nullable=False),
        sa.Column("target", sa.String(length=32), nullable=False),
        sa.Column(
            "field_names",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("image_path", sa.String(length=512), nullable=False),
        sa.Column("image_sha256", sa.String(length=64), nullable=False),
        sa.Column("content_type", sa.String(length=40), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("brightness", sa.Numeric(precision=8, scale=3), nullable=False),
        sa.Column("contrast", sa.Numeric(precision=10, scale=3), nullable=False),
        sa.Column("sharpness", sa.Numeric(precision=14, scale=3), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
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
            ["label_scan_id"],
            ["label_scans.id"],
            name=op.f("fk_label_scan_captures_label_scan_id_label_scans"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_label_scan_captures")),
        sa.UniqueConstraint("image_path", name=op.f("uq_label_scan_captures_image_path")),
    )
    op.create_index(
        op.f("ix_label_scan_captures_label_scan_id"),
        "label_scan_captures",
        ["label_scan_id"],
    )
    op.create_index(
        op.f("ix_label_scan_captures_image_sha256"),
        "label_scan_captures",
        ["image_sha256"],
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_label_scan_captures_image_sha256"),
        table_name="label_scan_captures",
    )
    op.drop_index(
        op.f("ix_label_scan_captures_label_scan_id"),
        table_name="label_scan_captures",
    )
    op.drop_table("label_scan_captures")
