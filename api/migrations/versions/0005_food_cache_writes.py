"""food cache writes

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-20 15:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "foods",
        sa.Column("kcal_mismatch", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    # The only way the API role writes the shared cache (foods RLS lets users write only their
    # own rows). It accepts nothing but FoodData Central and Open Food Facts rows with no owner,
    # upserts on (source, source_ref), touches updated_at for the 30-day refresh, and replaces
    # the food's serving units. Returns the food id.
    op.execute(
        """
        CREATE FUNCTION cache_food(p jsonb) RETURNS uuid
        LANGUAGE plpgsql VOLATILE SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $$
        DECLARE
          v_id uuid;
        BEGIN
          IF p->>'source' NOT IN ('fdc', 'off') OR coalesce(p->>'source_ref', '') = '' THEN
            RAISE EXCEPTION 'cache_food: only fdc and off rows with a source_ref';
          END IF;
          INSERT INTO foods (id, owner_id, source, source_ref, name, brand, kcal_100,
                             protein_100, carbs_100, fat_100, fiber_100, sugar_100,
                             sodium_mg_100, density_g_ml, kcal_mismatch)
          VALUES ((p->>'id')::uuid, NULL, p->>'source', p->>'source_ref', p->>'name',
                  p->>'brand', (p->>'kcal_100')::numeric, (p->>'protein_100')::numeric,
                  (p->>'carbs_100')::numeric, (p->>'fat_100')::numeric,
                  (p->>'fiber_100')::numeric, (p->>'sugar_100')::numeric,
                  (p->>'sodium_mg_100')::numeric, (p->>'density_g_ml')::numeric,
                  coalesce((p->>'kcal_mismatch')::boolean, false))
          ON CONFLICT (source, source_ref) WHERE owner_id IS NULL DO UPDATE SET
            name = EXCLUDED.name, brand = EXCLUDED.brand, kcal_100 = EXCLUDED.kcal_100,
            protein_100 = EXCLUDED.protein_100, carbs_100 = EXCLUDED.carbs_100,
            fat_100 = EXCLUDED.fat_100, fiber_100 = EXCLUDED.fiber_100,
            sugar_100 = EXCLUDED.sugar_100, sodium_mg_100 = EXCLUDED.sodium_mg_100,
            density_g_ml = EXCLUDED.density_g_ml, kcal_mismatch = EXCLUDED.kcal_mismatch,
            updated_at = now()
          RETURNING id INTO v_id;

          DELETE FROM serving_units WHERE food_id = v_id;
          INSERT INTO serving_units (id, food_id, label, grams, is_default)
          SELECT (u->>'id')::uuid, v_id, u->>'label', (u->>'grams')::numeric,
                 coalesce((u->>'is_default')::boolean, false)
          FROM jsonb_array_elements(coalesce(p->'servings', '[]'::jsonb)) AS u;
          RETURN v_id;
        END
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION cache_food(jsonb) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION cache_food(jsonb) TO trim_app")

    op.create_table(
        "food_queries",
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("query_hash", sa.LargeBinary(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("source", "query_hash", name=op.f("pk_food_queries")),
    )
    # No policies: the API role reaches it only through these two functions.
    op.execute("ALTER TABLE food_queries ENABLE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE FUNCTION food_query_fresh(p_source text, p_hash bytea, p_since timestamptz)
        RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
        AS $$ SELECT EXISTS (SELECT 1 FROM food_queries
                             WHERE source = p_source AND query_hash = p_hash
                             AND fetched_at >= p_since) $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION food_query_mark(p_source text, p_hash bytea, p_at timestamptz)
        RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
        AS $$ INSERT INTO food_queries (source, query_hash, fetched_at)
              VALUES (p_source, p_hash, p_at)
              ON CONFLICT (source, query_hash) DO UPDATE SET fetched_at = EXCLUDED.fetched_at $$
        """
    )
    for fn in (
        "food_query_fresh(text, bytea, timestamptz)",
        "food_query_mark(text, bytea, timestamptz)",
    ):
        op.execute(f"REVOKE ALL ON FUNCTION {fn} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {fn} TO trim_app")


def downgrade() -> None:
    op.execute("DROP FUNCTION food_query_mark(text, bytea, timestamptz)")
    op.execute("DROP FUNCTION food_query_fresh(text, bytea, timestamptz)")
    op.drop_table("food_queries")
    op.execute("DROP FUNCTION cache_food(jsonb)")
    op.drop_column("foods", "kcal_mismatch")
