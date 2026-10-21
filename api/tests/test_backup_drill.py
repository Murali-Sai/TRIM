"""Task 5.6: nightly encrypted backup and restore drill. AC: a backup restores into a scratch
database and matches its manifest (schema version, every table's row count, RLS still on).

Runs ops/backup.sh and ops/restore-drill.sh for real against the test database."""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url

from tests.conftest import OWNER_URL, ROOT, TEST_DB, CsrfClient
from tests.helpers import seed_food_rows, sign_up, user_row

pytestmark = pytest.mark.skipif(
    not all(shutil.which(t) for t in ("age", "age-keygen", "pg_dump", "pg_restore", "psql")),
    reason="needs age and the PostgreSQL client tools",
)


def libpq(database: str) -> str:
    """A plain postgresql:// URL for the command-line tools."""
    url = make_url(OWNER_URL).set(drivername="postgresql", database=database)
    return url.render_as_string(hide_password=False)


def scratch(name: str) -> str:
    admin = create_engine(OWNER_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()
    return libpq(name)


def sh(*cmd: str, **env: str) -> subprocess.CompletedProcess[str]:
    """Runs a tool by its full path (our own scripts and age; nothing from user input)."""
    exe = shutil.which(cmd[0]) or cmd[0]
    return subprocess.run(  # noqa: S603
        [exe, *cmd[1:]],
        env={**os.environ, **env},
        capture_output=True,
        text=True,
        check=False,
    )


def run(script: str, *args: str, **env: str) -> subprocess.CompletedProcess[str]:
    return sh("bash", str(ROOT / "ops" / script), *args, **env)


def new_key(path: Path) -> str:
    assert sh("age-keygen", "-o", str(path)).returncode == 0
    return sh("age-keygen", "-y", str(path)).stdout.strip()


@pytest.fixture
def backup(tmp_path: Path, client: CsrfClient, owner_engine: Engine) -> tuple[Path, Path]:
    # At least one account with rows in every user table.
    seed_food_rows(owner_engine, user_row(owner_engine, sign_up(client)).id)
    key = tmp_path / "key.txt"
    recipient = new_key(key)
    res = run(
        "backup.sh", str(tmp_path / "out"), SOURCE_URL=libpq(TEST_DB), AGE_RECIPIENTS=recipient
    )
    assert res.returncode == 0, res.stderr
    return Path(res.stdout.strip()), key


def test_ac_a_backup_restores_and_matches(backup: tuple[Path, Path]) -> None:
    file, key = backup
    assert file.name.startswith("trim-") and file.name.endswith(".tar.age")
    # Encrypted: no readable SQL or user data in the file.
    assert b"CREATE TABLE" not in file.read_bytes() and b"Overnight oats" not in file.read_bytes()
    res = run(
        "restore-drill.sh", str(file), TARGET_URL=scratch("trim_drill"), AGE_IDENTITY=str(key)
    )
    assert res.returncode == 0, res.stdout + res.stderr
    assert re.match(r"restore drill passed: schema \d{4}, \d+ tables", res.stdout)
    restored = create_engine(make_url(OWNER_URL).set(database="trim_drill"))
    with restored.connect() as conn:
        food_logs = conn.execute(text("SELECT count(*) FROM food_logs")).scalar_one()
        rls = conn.execute(
            text("SELECT relrowsecurity FROM pg_class WHERE relname = 'food_logs'")
        ).scalar_one()
    restored.dispose()
    assert food_logs > 0 and rls is True


def test_the_wrong_key_cannot_read_it(backup: tuple[Path, Path], tmp_path: Path) -> None:
    file, _ = backup
    other = tmp_path / "other.txt"
    new_key(other)
    res = run(
        "restore-drill.sh", str(file), TARGET_URL=scratch("trim_drill"), AGE_IDENTITY=str(other)
    )
    assert res.returncode != 0
    assert "no identity matched" in res.stderr


def test_a_drill_never_restores_over_data(backup: tuple[Path, Path]) -> None:
    file, key = backup
    res = run("restore-drill.sh", str(file), TARGET_URL=libpq(TEST_DB), AGE_IDENTITY=str(key))
    assert res.returncode != 0
    assert "the target database is not empty" in res.stdout
