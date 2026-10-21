"""staples

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-21 01:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

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
MAX_STAPLES = 20


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column("staples_offered_at", sa.DateTime(timezone=True), nullable=True),
    )
    groups = ", ".join(repr(g) for g in FOOD_GROUPS)
    op.create_table(
        "staples",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("food_id", sa.UUID(), nullable=True),
        sa.Column("saved_meal_id", sa.UUID(), nullable=True),
        sa.Column("food_group", sa.Text(), nullable=True),
        sa.Column("unit_label", sa.Text(), nullable=False),
        sa.Column("unit_grams", sa.Numeric(precision=8, scale=2), nullable=True),
        sa.Column("step_units", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("min_units", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("max_units", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("is_available", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
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
            "(food_id IS NULL) <> (saved_meal_id IS NULL)", name=op.f("ck_staples_one_source")
        ),
        sa.CheckConstraint(
            f"food_group IS NULL OR food_group IN ({groups})", name=op.f("ck_staples_food_group")
        ),
        sa.CheckConstraint(
            "step_units > 0 AND min_units > 0 AND max_units >= min_units",
            name=op.f("ck_staples_amounts"),
        ),
        sa.CheckConstraint(
            "unit_grams IS NULL OR unit_grams > 0", name=op.f("ck_staples_unit_grams_positive")
        ),
        sa.ForeignKeyConstraint(
            ["food_id"], ["foods.id"], name=op.f("fk_staples_food_id_foods"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["saved_meal_id"],
            ["saved_meals.id"],
            name=op.f("fk_staples_saved_meal_id_saved_meals"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_staples_user_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_staples")),
    )
    op.create_index(op.f("ix_staples_user_id"), "staples", ["user_id"])
    op.create_index(op.f("ix_staples_food_id"), "staples", ["food_id"])
    op.create_index(op.f("ix_staples_saved_meal_id"), "staples", ["saved_meal_id"])

    # Row-level security in the same migration that creates the table (AGENTS.md). An item may
    # only point at a meal the owner can see.
    op.execute("ALTER TABLE staples ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY staples_owner ON staples "
        "USING (user_id = app_current_user_id()) "
        "WITH CHECK (user_id = app_current_user_id() AND (saved_meal_id IS NULL OR EXISTS "
        "(SELECT 1 FROM saved_meals m WHERE m.id = saved_meal_id)))"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON staples TO trim_app")

    # At most 20 staples per user (SPEC page 2), whatever writes the row.
    op.execute(
        f"""
        CREATE FUNCTION staples_limit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF (SELECT count(*) FROM staples
              WHERE user_id = NEW.user_id AND deleted_at IS NULL) >= {MAX_STAPLES} THEN
            RAISE EXCEPTION 'staples_limit' USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END $$
        """
    )
    op.execute(
        "CREATE TRIGGER staples_limit BEFORE INSERT ON staples "
        "FOR EACH ROW EXECUTE FUNCTION staples_limit()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER staples_limit ON staples")
    op.execute("DROP FUNCTION staples_limit()")
    op.drop_index(op.f("ix_staples_saved_meal_id"), table_name="staples")
    op.drop_index(op.f("ix_staples_food_id"), table_name="staples")
    op.drop_index(op.f("ix_staples_user_id"), table_name="staples")
    op.drop_table("staples")
    op.drop_column("user_settings", "staples_offered_at")
