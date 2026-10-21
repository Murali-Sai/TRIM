"""pairing scores

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-21 13:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONTEXTS = ("breakfast", "lunch", "dinner", "snack")
FOOD_GROUPS = (
    "poultry",
    "red_meat",
    "fish_seafood",
    "eggs",
    "rice_grains",
    "bread_tortillas",
    "pasta",
    "cereal_oats",
    "vegetables",
    "fruit",
    "yogurt",
    "milk",
    "cheese",
    "nuts_butters",
    "beans_legumes",
    "tofu_plant_protein",
    "potatoes",
    "sweets_desserts",
    "savory_snacks",
    "shakes_bars",
    "sauces_condiments",
    "fats_oils",
    "mixed_dishes",
)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


def upgrade() -> None:
    # Shared reference data (no user rows), so no RLS: every user reads the same table and
    # only the owner role loads it (tools/load_pairing.py).
    op.create_table(
        "pairing_scores",
        sa.Column("context", sa.Text(), nullable=False),
        sa.Column("group_a", sa.Text(), nullable=False),
        sa.Column("group_b", sa.Text(), nullable=False),
        sa.Column("plates", sa.Integer(), nullable=False),
        sa.Column("lift", sa.Numeric(precision=10, scale=4), nullable=True),
        sa.Column("score", sa.Numeric(precision=6, scale=4), nullable=False),
        sa.Column("data_version", sa.Text(), nullable=False),
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
        sa.CheckConstraint(_in("context", CONTEXTS), name=op.f("ck_pairing_scores_context")),
        sa.CheckConstraint(
            f"{_in('group_a', FOOD_GROUPS)} AND {_in('group_b', FOOD_GROUPS)} "
            "AND group_a < group_b",
            name=op.f("ck_pairing_scores_groups"),
        ),
        sa.CheckConstraint("score BETWEEN -2 AND 2", name=op.f("ck_pairing_scores_score_range")),
        sa.PrimaryKeyConstraint("context", "group_a", "group_b", name=op.f("pk_pairing_scores")),
    )
    op.execute("GRANT SELECT ON pairing_scores TO trim_app")


def downgrade() -> None:
    op.drop_table("pairing_scores")
