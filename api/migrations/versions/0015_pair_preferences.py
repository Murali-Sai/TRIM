"""pair preferences

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-21 14:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "pair_preferences",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("staple_a_id", sa.UUID(), nullable=False),
        sa.Column("staple_b_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), server_default="never", nullable=False),
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
        sa.CheckConstraint("kind = 'never'", name=op.f("ck_pair_preferences_kind")),
        sa.CheckConstraint("staple_a_id < staple_b_id", name=op.f("ck_pair_preferences_ordered")),
        sa.ForeignKeyConstraint(
            ["staple_a_id"],
            ["staples.id"],
            name=op.f("fk_pair_preferences_staple_a_id_staples"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["staple_b_id"],
            ["staples.id"],
            name=op.f("fk_pair_preferences_staple_b_id_staples"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_pair_preferences_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_pair_preferences")),
    )
    op.create_index(op.f("ix_pair_preferences_user_id"), "pair_preferences", ["user_id"])
    op.create_index(
        "uq_pair_preferences_pair",
        "pair_preferences",
        ["user_id", "staple_a_id", "staple_b_id"],
        unique=True,
    )

    # Row-level security in the same migration that creates the table (AGENTS.md). Both
    # staples must be ones the owner can see.
    op.execute("ALTER TABLE pair_preferences ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY pair_preferences_owner ON pair_preferences "
        "USING (user_id = app_current_user_id()) "
        "WITH CHECK (user_id = app_current_user_id() "
        "AND EXISTS (SELECT 1 FROM staples s WHERE s.id = staple_a_id) "
        "AND EXISTS (SELECT 1 FROM staples s WHERE s.id = staple_b_id))"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON pair_preferences TO trim_app")


def downgrade() -> None:
    op.drop_index("uq_pair_preferences_pair", table_name="pair_preferences")
    op.drop_index(op.f("ix_pair_preferences_user_id"), table_name="pair_preferences")
    op.drop_table("pair_preferences")
