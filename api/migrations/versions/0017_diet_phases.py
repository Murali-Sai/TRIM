"""diet phases

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-21 16:00:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "diet_phases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
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
            "kind IN ('cut', 'maintain', 'bulk', 'custom')", name=op.f("ck_diet_phases_kind")
        ),
        sa.CheckConstraint(
            "end_date IS NULL OR end_date >= start_date", name=op.f("ck_diet_phases_dates")
        ),
        sa.CheckConstraint(
            "kind <> 'custom' OR label IS NOT NULL", name=op.f("ck_diet_phases_custom_has_label")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_diet_phases_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_diet_phases")),
    )
    op.create_index(op.f("ix_diet_phases_user_id"), "diet_phases", ["user_id"])

    # Row-level security in the same migration that creates the table (AGENTS.md).
    op.execute("ALTER TABLE diet_phases ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY diet_phases_owner ON diet_phases "
        "USING (user_id = app_current_user_id()) "
        "WITH CHECK (user_id = app_current_user_id())"
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON diet_phases TO trim_app")

    # No two of a user's phases may overlap (SPEC page 2), whatever writes the row. An ongoing
    # phase (no end date) runs to infinity; both ends are inclusive.
    op.execute(
        """
        CREATE FUNCTION diet_phases_no_overlap() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.deleted_at IS NULL AND EXISTS (
            SELECT 1 FROM diet_phases p
            WHERE p.user_id = NEW.user_id AND p.id <> NEW.id AND p.deleted_at IS NULL
              AND daterange(p.start_date, p.end_date, '[]')
                  && daterange(NEW.start_date, NEW.end_date, '[]')
          ) THEN
            RAISE EXCEPTION 'phase_overlap' USING ERRCODE = 'exclusion_violation';
          END IF;
          RETURN NEW;
        END $$
        """
    )
    op.execute(
        "CREATE TRIGGER diet_phases_no_overlap BEFORE INSERT OR UPDATE ON diet_phases "
        "FOR EACH ROW EXECUTE FUNCTION diet_phases_no_overlap()"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER diet_phases_no_overlap ON diet_phases")
    op.execute("DROP FUNCTION diet_phases_no_overlap()")
    op.drop_index(op.f("ix_diet_phases_user_id"), table_name="diet_phases")
    op.drop_table("diet_phases")
