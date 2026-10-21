"""streak reminders: push subscriptions and the reminder setting

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-21 00:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_settings", sa.Column("streak_reminder", sa.Text(), nullable=True))
    op.add_column("user_settings", sa.Column("last_reminded_on", sa.Date(), nullable=True))
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_push_subscriptions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_push_subscriptions")),
    )
    op.create_index(op.f("ix_push_subscriptions_user_id"), "push_subscriptions", ["user_id"])
    op.create_index(
        "uq_push_subscriptions_user_endpoint",
        "push_subscriptions",
        ["user_id", "endpoint"],
        unique=True,
    )

    # Row-level security in the same migration that creates the table (AGENTS.md).
    op.execute("ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY push_subscriptions_owner ON push_subscriptions "
        "USING (user_id = app_current_user_id()) "
        "WITH CHECK (user_id = app_current_user_id())"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON push_subscriptions TO trim_app")

    # The hourly job's only cross-user read: who wants a reminder, and where and when. Each
    # user's own data is then read under their RLS session.
    op.execute(
        """
        CREATE FUNCTION reminder_candidates()
        RETURNS TABLE (user_id uuid, timezone text, reminder text, last_reminded_on date)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
        AS $$
          SELECT s.user_id, p.timezone, s.streak_reminder, s.last_reminded_on
          FROM user_settings s
          JOIN user_profiles p ON p.user_id = s.user_id
          JOIN users u ON u.id = s.user_id
          WHERE s.streak_reminder IS NOT NULL AND s.gamification AND u.status = 'active'
            AND EXISTS (SELECT 1 FROM push_subscriptions ps
                        WHERE ps.user_id = s.user_id AND ps.deleted_at IS NULL)
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION reminder_candidates() FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION reminder_candidates() TO trim_app")


def downgrade() -> None:
    op.execute("DROP FUNCTION reminder_candidates()")
    op.drop_index("uq_push_subscriptions_user_endpoint", table_name="push_subscriptions")
    op.drop_index(op.f("ix_push_subscriptions_user_id"), table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
    op.drop_column("user_settings", "last_reminded_on")
    op.drop_column("user_settings", "streak_reminder")
