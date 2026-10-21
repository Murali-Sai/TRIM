"""Task 5.5: the secret grep. AC: it passes on the repository (and CI runs it on the built
site); it catches the shapes real credentials have."""

from pathlib import Path

import pytest

from tools import secret_grep as sg

# Built from parts so this file never holds a whole fake key for other scanners to trip on.
KEY_BLOCK = "-----BEGIN " + "PRIVATE KEY-----"
AWS = "AKIA" + "ABCDEFGHIJKLMNOP"
GITHUB = "ghp_" + "a" * 36
RESEND = "re_" + "abcdefgh_" + "x" * 20
ASSIGN = 'TRIM_JOB_TOKEN = "' + "k" * 30 + '"'


def test_ac_the_repository_is_clean() -> None:
    assert sg.scan(sg.tracked_files(), sg.ROOT) == []


@pytest.mark.parametrize(
    ("line", "kind"),
    [
        (KEY_BLOCK, "private key"),
        (f"aws_key: {AWS}", "AWS access key"),
        (f"token {GITHUB}", "GitHub token"),
        (f"RESEND={RESEND}", "Resend key"),
        (ASSIGN, "secret-looking assignment"),
        (
            "url = 'postgresql://app:" + "p" * 16 + "@ep-cool.us-east-2.aws.neon.tech/db'",
            "Neon connection string with a password",
        ),
    ],
)
def test_catches(line: str, kind: str) -> None:
    assert [f.kind for f in sg.scan_text("x.py", line)] == [kind]


def test_ordinary_code_and_allowed_lines_pass() -> None:
    text = "\n".join(
        [
            "password: str = Field(min_length=12)",
            'TOKEN_KINDS = ("verify", "reset")',
            "api_key = settings.fdc_api_key.get_secret_value()",
            f'TEST_SECRET = "{"0" * 30}"  # secret-grep: allow',
        ]
    )
    assert sg.scan_text("x.py", text) == []


def test_the_built_site_must_not_name_server_settings(tmp_path: Path) -> None:
    (tmp_path / "app.js").write_text('const k = "TRIM_RESEND_API_KEY";')
    (tmp_path / "ok.js").write_text("fetch('/api/health')")
    found = sg.scan(tmp_path.rglob("*"), tmp_path, bundle=True)
    assert [(f.path, f.kind) for f in found] == [
        ("app.js", "server-only setting in the built site")
    ]


def test_a_committed_env_file_fails(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("X=1")
    (tmp_path / ".env.example").write_text("X=")
    assert [f.path for f in sg.scan(tmp_path.rglob("*"), tmp_path)] == [".env"]
