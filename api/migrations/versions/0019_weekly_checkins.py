"""weekly check-ins

Revision ID: 0019
Revises: 0018
Create Date: 2026-10-21 20:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "weekly_checkins",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("week_start", sa.Date(), nullable=False),
        sa.Column("stats", postgresql.JSONB(), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("emailed_at", sa.DateTime(timezone=True), nullable=True),
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
            "extract(isodow FROM week_start) = 1", name=op.f("ck_weekly_checkins_monday")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_weekly_checkins_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_weekly_checkins")),
    )
    op.create_index(op.f("ix_weekly_checkins_user_id"), "weekly_checkins", ["user_id"])
    op.create_index(
        "uq_weekly_checkins_user_week", "weekly_checkins", ["user_id", "week_start"], unique=True
    )

    # Row-level security in the same migration that creates the table (AGENTS.md).
    op.execute("ALTER TABLE weekly_checkins ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY weekly_checkins_owner ON weekly_checkins "
        "USING (user_id = app_current_user_id()) "
        "WITH CHECK (user_id = app_current_user_id())"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON weekly_checkins TO trim_app")

    op.add_column(
        "user_settings",
        sa.Column("checkin_email", sa.Boolean(), server_default=sa.false(), nullable=False),
    )

    # The job's cross-user reads. Who might be due a check-in (each user's data is then read
    # under their own RLS session), and the email queue with today's count for the 90-a-day cap.
    # The latest due week for each user is the Monday of (local time - 6 hours), minus 7 days:
    # last week from Monday 06:00 on (app/checkins.py, due_week). Only users still missing it,
    # and only for a week that ends on or after the day they signed up.
    op.execute(
        """
        CREATE FUNCTION checkins_due(at timestamptz)
        RETURNS TABLE (user_id uuid, timezone text, week_start date)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
        AS $$
          SELECT u.id, p.timezone, w.week_start
          FROM users u
          JOIN user_profiles p ON p.user_id = u.id
          CROSS JOIN LATERAL (
            SELECT (date_trunc('week', (at AT TIME ZONE p.timezone) - interval '6 hours')::date
                    - 7) AS week_start
          ) w
          WHERE u.status = 'active' AND u.deleted_at IS NULL
            AND (u.created_at AT TIME ZONE p.timezone)::date <= w.week_start + 6
            AND NOT EXISTS (SELECT 1 FROM weekly_checkins c
                            WHERE c.user_id = u.id AND c.week_start = w.week_start)
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION checkin_email_queue(max_rows integer)
        RETURNS TABLE (checkin_id uuid, user_id uuid)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
        AS $$
          SELECT c.id, c.user_id
          FROM weekly_checkins c
          JOIN user_settings s ON s.user_id = c.user_id
          JOIN users u ON u.id = c.user_id
          WHERE c.emailed_at IS NULL AND c.deleted_at IS NULL AND s.checkin_email
            AND u.status = 'active' AND u.email_verified_at IS NOT NULL
          ORDER BY c.created_at, c.id
          LIMIT max_rows
        $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION checkin_emails_sent_since(since timestamptz)
        RETURNS bigint
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
        AS $$
          SELECT count(*) FROM weekly_checkins WHERE emailed_at >= since
        $$
        """
    )
    for fn in (
        "checkins_due(timestamptz)",
        "checkin_email_queue(integer)",
        "checkin_emails_sent_since(timestamptz)",
    ):
        op.execute(f"REVOKE ALL ON FUNCTION {fn} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {fn} TO trim_app")


def downgrade() -> None:
    op.execute("DROP FUNCTION checkin_emails_sent_since(timestamptz)")
    op.execute("DROP FUNCTION checkin_email_queue(integer)")
    op.execute("DROP FUNCTION checkins_due(timestamptz)")
    op.drop_column("user_settings", "checkin_email")
    op.drop_index("uq_weekly_checkins_user_week", table_name="weekly_checkins")
    op.drop_index(op.f("ix_weekly_checkins_user_id"), table_name="weekly_checkins")
    op.drop_table("weekly_checkins")
