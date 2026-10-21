"""usage counters and alerts

Revision ID: 0020
Revises: 0019
Create Date: 2026-10-21 22:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Shared, not user data: how many emails and food-database calls the whole app made each
    # hour (task 5.7), and which free-tier alerts went out. No user_id, so no RLS.
    op.create_table(
        "usage_counters",
        sa.Column("metric", sa.Text(), nullable=False),
        sa.Column("hour", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("metric", "hour", name=op.f("pk_usage_counters")),
    )
    op.create_table(
        "usage_alerts",
        sa.Column("limit_key", sa.Text(), nullable=False),
        sa.Column("period", sa.Text(), nullable=False),
        sa.Column("value", sa.Float(), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("limit_key", "period", name=op.f("pk_usage_alerts")),
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON usage_counters, usage_alerts TO trim_app")


def downgrade() -> None:
    op.drop_table("usage_alerts")
    op.drop_table("usage_counters")
