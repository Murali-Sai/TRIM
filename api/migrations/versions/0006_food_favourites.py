"""food favourites

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-20 18:30:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "food_favourites",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("food_id", sa.UUID(), nullable=False),
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
            ["food_id"],
            ["foods.id"],
            name=op.f("fk_food_favourites_food_id_foods"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_food_favourites_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_food_favourites")),
    )
    op.create_index(op.f("ix_food_favourites_food_id"), "food_favourites", ["food_id"])
    op.create_index(op.f("ix_food_favourites_user_id"), "food_favourites", ["user_id"])
    op.create_index(
        "uq_food_favourites_user_food", "food_favourites", ["user_id", "food_id"], unique=True
    )

    # Row-level security in the same migration that creates the table (AGENTS.md).
    op.execute("ALTER TABLE food_favourites ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY food_favourites_owner ON food_favourites "
        "USING (user_id = app_current_user_id()) "
        "WITH CHECK (user_id = app_current_user_id())"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON food_favourites TO trim_app")


def downgrade() -> None:
    op.drop_index("uq_food_favourites_user_food", table_name="food_favourites")
    op.drop_index(op.f("ix_food_favourites_user_id"), table_name="food_favourites")
    op.drop_index(op.f("ix_food_favourites_food_id"), table_name="food_favourites")
    op.drop_table("food_favourites")
