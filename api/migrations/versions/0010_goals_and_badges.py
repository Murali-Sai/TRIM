"""weekly goals and badges

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-20 23:30:00
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
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
        "weekly_goals",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("needed", sa.Integer(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed", sa.Boolean(), server_default=sa.false(), nullable=False),
        *_timestamps(),
        sa.CheckConstraint(
            "kind IN ('log_food', 'protein', 'calories', 'weigh_in', 'water', 'measurement')",
            name=op.f("ck_weekly_goals_kind"),
        ),
        sa.CheckConstraint("needed > 0", name=op.f("ck_weekly_goals_needed_positive")),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_weekly_goals_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_weekly_goals")),
    )
    op.create_index(op.f("ix_weekly_goals_user_id"), "weekly_goals", ["user_id"])
    op.create_index(
        "uq_weekly_goals_user_week_kind",
        "weekly_goals",
        ["user_id", "week_start", "kind"],
        unique=True,
    )
    op.create_table(
        "user_badges",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("badge", sa.Text(), nullable=False),
        sa.Column("earned_at", sa.DateTime(timezone=True), nullable=False),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_badges_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_badges")),
    )
    op.create_index(op.f("ix_user_badges_user_id"), "user_badges", ["user_id"])
    op.create_index("uq_user_badges_user_badge", "user_badges", ["user_id", "badge"], unique=True)

    # Row-level security in the same migration that creates the tables (AGENTS.md).
    for table in ("weekly_goals", "user_badges"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_owner ON {table} "
            "USING (user_id = app_current_user_id()) "
            "WITH CHECK (user_id = app_current_user_id())"
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO trim_app")


def downgrade() -> None:
    op.drop_index("uq_user_badges_user_badge", table_name="user_badges")
    op.drop_index(op.f("ix_user_badges_user_id"), table_name="user_badges")
    op.drop_table("user_badges")
    op.drop_index("uq_weekly_goals_user_week_kind", table_name="weekly_goals")
    op.drop_index(op.f("ix_weekly_goals_user_id"), table_name="weekly_goals")
    op.drop_table("weekly_goals")
