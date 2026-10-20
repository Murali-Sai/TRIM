"""streaks

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-20 23:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_streaks",
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("current_days", sa.Integer(), server_default="0", nullable=False),
        sa.Column("longest_days", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_counted_date", sa.Date(), nullable=True),
        sa.Column("freezes_held", sa.SmallInteger(), server_default="0", nullable=False),
        sa.Column("weigh_in_current_weeks", sa.Integer(), server_default="0", nullable=False),
        sa.Column("weigh_in_longest_weeks", sa.Integer(), server_default="0", nullable=False),
        sa.Column("weigh_in_last_week", sa.Date(), nullable=True),
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
        sa.CheckConstraint(
            "current_days >= 0 AND longest_days >= current_days", name=op.f("ck_user_streaks_days")
        ),
        sa.CheckConstraint(
            "freezes_held BETWEEN 0 AND 2", name=op.f("ck_user_streaks_freezes_held")
        ),
        sa.CheckConstraint(
            "weigh_in_current_weeks >= 0 AND weigh_in_longest_weeks >= weigh_in_current_weeks",
            name=op.f("ck_user_streaks_weeks"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_user_streaks_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_user_streaks")),
    )
    op.create_table(
        "streak_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("on_date", sa.Date(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
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
        sa.CheckConstraint(
            "kind IN ('counted', 'freeze_earned', 'freeze_used', 'repaired', 'broken')",
            name=op.f("ck_streak_events_kind"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_streak_events_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_streak_events")),
    )
    op.create_index(op.f("ix_streak_events_user_id"), "streak_events", ["user_id"])
    op.create_index("ix_streak_events_user_date", "streak_events", ["user_id", "on_date"])

    # Row-level security in the same migration that creates the tables (AGENTS.md).
    for table in ("user_streaks", "streak_events"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_owner ON {table} "
            "USING (user_id = app_current_user_id()) "
            "WITH CHECK (user_id = app_current_user_id())"
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO trim_app")


def downgrade() -> None:
    op.drop_index("ix_streak_events_user_date", table_name="streak_events")
    op.drop_index(op.f("ix_streak_events_user_id"), table_name="streak_events")
    op.drop_table("streak_events")
    op.drop_table("user_streaks")
