"""water logs and user settings

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-20 22:00:00
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _timestamps() -> list[sa.Column[Any]]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        "user_settings",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("track_water", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("track_fiber", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("water_unit", sa.Text(), server_default="ml", nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "water_unit IN ('ml', 'fl_oz')", name=op.f("ck_user_settings_water_unit")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_settings_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_user_settings")),
    )
    op.create_table(
        "water_logs",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("logged_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("logged_on", sa.Date(), nullable=False),
        sa.Column("ml", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint("ml > 0 AND ml <= 5000", name=op.f("ck_water_logs_ml_range")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_water_logs_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_water_logs")),
    )
    op.create_index(op.f("ix_water_logs_user_id"), "water_logs", ["user_id"])
    op.create_index("ix_water_logs_user_day", "water_logs", ["user_id", "logged_on"])

    # Row-level security in the same migration that creates the tables (AGENTS.md).
    for table in ("user_settings", "water_logs"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_owner ON {table} "
            "USING (user_id = app_current_user_id()) "
            "WITH CHECK (user_id = app_current_user_id())"
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO trim_app")


def downgrade() -> None:
    op.drop_index("ix_water_logs_user_day", table_name="water_logs")
    op.drop_index(op.f("ix_water_logs_user_id"), table_name="water_logs")
    op.drop_table("water_logs")
    op.drop_table("user_settings")
