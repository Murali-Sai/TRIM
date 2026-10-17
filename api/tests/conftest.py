"""Test database setup.

Database tests run against a real Postgres (Docker locally, a service container in CI), because
row-level security cannot be faked. Each session creates a fresh database, migrates it as the
owner, and connects the app as trim_api, which is subject to RLS exactly as in production.
"""

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url

OWNER_URL = os.environ.get(
    "TRIM_TEST_OWNER_URL", "postgresql+psycopg://trim:trim@127.0.0.1:5433/postgres"
)
APP_LOGIN = os.environ.get("TRIM_TEST_APP_LOGIN", "trim_api:trim_api")
TEST_DB = "trim_test"

ROOT = Path(__file__).resolve().parents[2]
API_DIR = Path(__file__).resolve().parents[1]


def db_url(database: str, login: str | None = None) -> str:
    url = make_url(OWNER_URL).set(database=database)
    if login:
        user, password = login.split(":", 1)
        url = url.set(username=user, password=password)
    return url.render_as_string(hide_password=False)


# Point the app at the test database before anything reads settings.
os.environ["TRIM_DATABASE_URL"] = db_url(TEST_DB, APP_LOGIN)
os.environ["TRIM_MIGRATION_DATABASE_URL"] = db_url(TEST_DB)


def recreate_database(name: str) -> None:
    admin = create_engine(OWNER_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{name}"'))
        conn.exec_driver_sql((ROOT / "db" / "init" / "01-roles.sql").read_text())
    admin.dispose()


def migrate(url: str, revision: str = "head", down: bool = False) -> None:
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(API_DIR / "migrations"))
    cfg.attributes["url"] = url
    if down:
        command.downgrade(cfg, revision)
    else:
        command.upgrade(cfg, revision)


@pytest.fixture(scope="session")
def owner_engine() -> Iterator[Engine]:
    """The migrated test database, connected as its owner (bypasses RLS; for setup checks only)."""
    recreate_database(TEST_DB)
    migrate(db_url(TEST_DB))
    engine = create_engine(db_url(TEST_DB))
    yield engine
    engine.dispose()
    from app.db import get_engine

    get_engine().dispose()


@pytest.fixture(scope="session")
def app_engine(owner_engine: Engine) -> Engine:
    """The app's own engine (trim_api), subject to RLS."""
    from app.db import get_engine

    return get_engine()
