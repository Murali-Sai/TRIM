"""exports audit

Revision ID: 0018
Revises: 0017
Create Date: 2026-10-21 18:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "exports",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("format", sa.Text(), nullable=False),
        sa.Column("date_from", sa.Date(), nullable=True),
        sa.Column("date_to", sa.Date(), nullable=True),
        sa.Column("datasets", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
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
        sa.CheckConstraint("format IN ('xlsx', 'csv', 'json')", name=op.f("ck_exports_format")),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_exports_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_exports")),
    )
    op.create_index(op.f("ix_exports_user_id"), "exports", ["user_id"])

    # Row-level security in the same migration that creates the table (AGENTS.md).
    op.execute("ALTER TABLE exports ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY exports_owner ON exports "
        "USING (user_id = app_current_user_id()) "
        "WITH CHECK (user_id = app_current_user_id())"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON exports TO trim_app")


def downgrade() -> None:
    op.drop_index(op.f("ix_exports_user_id"), table_name="exports")
    op.drop_table("exports")
