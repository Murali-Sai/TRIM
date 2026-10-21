"""measurements

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-21 15:00:00
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UNITS = ("cm", "in", "%", "kg", "lb", "text")


def _ts() -> list[sa.Column[Any]]:
    return [
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
    ]


def upgrade() -> None:
    units = ", ".join(repr(u) for u in UNITS)
    op.create_table(
        "measurement_types",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("unit", sa.Text(), nullable=False),
        sa.Column("precision", sa.SmallInteger(), server_default="1", nullable=False),
        sa.Column("side", sa.Text(), nullable=True),
        sa.Column("pair_id", sa.UUID(), nullable=True),
        sa.Column("is_preset", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        *_ts(),
        sa.CheckConstraint(f"unit IN ({units})", name=op.f("ck_measurement_types_unit")),
        sa.CheckConstraint(
            "side IS NULL OR side IN ('left', 'right')", name=op.f("ck_measurement_types_side")
        ),
        sa.CheckConstraint(
            "precision BETWEEN 0 AND 3", name=op.f("ck_measurement_types_precision_range")
        ),
        sa.CheckConstraint(
            "(side IS NULL) = (pair_id IS NULL)", name=op.f("ck_measurement_types_pair_has_side")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_measurement_types_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_measurement_types")),
    )
    op.create_index(op.f("ix_measurement_types_user_id"), "measurement_types", ["user_id"])
    op.create_table(
        "measurement_entries",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("type_id", sa.UUID(), nullable=False),
        sa.Column("value", sa.Numeric(precision=8, scale=3), nullable=True),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        *_ts(),
        sa.CheckConstraint(
            "(value IS NULL) <> (value_text IS NULL)", name=op.f("ck_measurement_entries_one_value")
        ),
        sa.CheckConstraint(
            "value IS NULL OR value > 0", name=op.f("ck_measurement_entries_value_positive")
        ),
        sa.ForeignKeyConstraint(
            ["type_id"],
            ["measurement_types.id"],
            name=op.f("fk_measurement_entries_type_id_measurement_types"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_measurement_entries_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_measurement_entries")),
    )
    op.create_index(op.f("ix_measurement_entries_user_id"), "measurement_entries", ["user_id"])
    op.create_index(
        "ix_measurement_entries_type_measured", "measurement_entries", ["type_id", "measured_at"]
    )

    # Row-level security in the same migration that creates the tables (AGENTS.md). An entry
    # may only point at one of the owner's own metrics.
    op.execute("ALTER TABLE measurement_types ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY measurement_types_owner ON measurement_types "
        "USING (user_id = app_current_user_id()) "
        "WITH CHECK (user_id = app_current_user_id())"
    )
    op.execute("ALTER TABLE measurement_entries ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY measurement_entries_owner ON measurement_entries "
        "USING (user_id = app_current_user_id()) "
        "WITH CHECK (user_id = app_current_user_id() AND EXISTS "
        "(SELECT 1 FROM measurement_types t WHERE t.id = type_id))"
    )
    for table in ("measurement_types", "measurement_entries"):
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO trim_app")

    # Accounts made before this migration get the presets too (switched off), as new sign-ups
    # do (app/measurements.py PRESETS).
    op.execute(
        """
        INSERT INTO measurement_types (id, user_id, name, unit, precision, side, pair_id,
                                       is_preset, is_active, sort_order)
        SELECT gen_random_uuid(), p.user_id, x.name,
               CASE WHEN x.unit = 'cm' AND p.unit_system = 'imperial' THEN 'in' ELSE x.unit END,
               1, x.side, CASE WHEN x.side IS NULL THEN NULL ELSE pair.id END,
               true, false, x.ord
        FROM user_profiles p
        CROSS JOIN (VALUES
            ('Waist', 'cm', NULL, 0, NULL), ('Hips', 'cm', NULL, 1, NULL),
            ('Chest', 'cm', NULL, 2, NULL), ('Neck', 'cm', NULL, 3, NULL),
            ('Upper arm', 'cm', 'left', 4, 1), ('Upper arm', 'cm', 'right', 5, 1),
            ('Thigh', 'cm', 'left', 6, 2), ('Thigh', 'cm', 'right', 7, 2),
            ('Body fat', '%', NULL, 8, NULL)
        ) AS x(name, unit, side, ord, pair_no)
        LEFT JOIN LATERAL (
            SELECT md5(p.user_id::text || x.pair_no::text)::uuid AS id
        ) pair ON true
        """
    )


def downgrade() -> None:
    op.drop_index("ix_measurement_entries_type_measured", table_name="measurement_entries")
    op.drop_index(op.f("ix_measurement_entries_user_id"), table_name="measurement_entries")
    op.drop_table("measurement_entries")
    op.drop_index(op.f("ix_measurement_types_user_id"), table_name="measurement_types")
    op.drop_table("measurement_types")
