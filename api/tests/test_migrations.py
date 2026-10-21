from sqlalchemy import create_engine, inspect

from tests.conftest import db_url, migrate, recreate_database

MIGRATIONS_DB = "trim_test_migrations"


def test_upgrade_downgrade_upgrade() -> None:
    recreate_database(MIGRATIONS_DB)
    url = db_url(MIGRATIONS_DB)
    engine = create_engine(url)
    try:
        migrate(url)
        assert {
            "users",
            "sessions",
            "auth_tokens",
            "audit_log",
            "user_profiles",
            "weight_entries",
            "targets",
            "foods",
            "serving_units",
            "food_logs",
            "food_favourites",
            "saved_meals",
            "saved_meal_items",
            "user_settings",
            "water_logs",
            "user_streaks",
            "streak_events",
            "weekly_goals",
            "user_badges",
            "push_subscriptions",
            "staples",
            "pairing_scores",
            "pair_preferences",
            "measurement_types",
            "measurement_entries",
        } <= set(inspect(engine).get_table_names())
        migrate(url, "base", down=True)
        assert set(inspect(engine).get_table_names()) == {"alembic_version"}
        migrate(url)
        assert "users" in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_models_match_migrations() -> None:
    """Fails when a model changes without a migration (alembic check)."""
    from alembic import command
    from alembic.config import Config

    from tests.conftest import API_DIR

    recreate_database(MIGRATIONS_DB)
    url = db_url(MIGRATIONS_DB)
    migrate(url)
    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["url"] = url
    command.check(cfg)
