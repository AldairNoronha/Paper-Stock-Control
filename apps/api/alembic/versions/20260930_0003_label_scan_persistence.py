"""Harden label scan persistence for the mobile receiving workflow.

Revision ID: 20260930_0003
Revises: 20260929_0002
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260930_0003"
down_revision: str | None = "20260929_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "uq_label_scans_image_sha256",
        "label_scans",
        ["image_sha256"],
        unique=True,
        postgresql_where=sa.text("image_sha256 IS NOT NULL"),
    )
    op.create_unique_constraint(
        "uq_label_field_readings_label_scan_field_name",
        "label_field_readings",
        ["label_scan_id", "field_name"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_label_field_readings_label_scan_field_name",
        "label_field_readings",
        type_="unique",
    )
    op.drop_index("uq_label_scans_image_sha256", table_name="label_scans")
