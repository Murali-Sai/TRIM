"""Secret grep (task 5.5): fail when a key, token or private key is committed or bundled.

    uv run python tools/secret_grep.py            # every file git tracks
    uv run python tools/secret_grep.py ../web/dist --bundle   # the built site, too

Looks for the shapes real credentials have (private key blocks, cloud and service key
prefixes, long values assigned to secret-looking names), any tracked .env file, and, in the
built site, the names of server-only settings, which must never reach the browser. A line
ending in a "secret-grep: allow" comment is skipped (for documented test values).
"""

import argparse
import re
import shutil
import subprocess
import sys
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ALLOW = "secret-grep: allow"

PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("service account key", re.compile(r'"private_key"\s*:\s*"-----BEGIN')),
    ("AWS access key", re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("GitHub token", re.compile(r"\b(ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{36}\b|github_pat_\w{40,}")),
    ("Resend key", re.compile(r"\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("Stripe live key", re.compile(r"\b[sr]k_live_[A-Za-z0-9]{16,}")),
    (
        "Neon connection string with a password",
        re.compile(r"postgres(ql)?://\w+:[^@\s'\"]{12,}@[\w.-]*neon\.tech"),
    ),
    (
        "secret-looking assignment",
        re.compile(
            r"(?i)\b[\w-]*(secret|token|password|passwd|api[_-]?key|private[_-]?key|pepper)"
            r"[\w-]*\b\s*[:=]\s*['\"]([A-Za-z0-9+/_=.-]{24,})['\"]"
        ),
    ),
]
# Server-only settings: their names in the built site would mean a server value was bundled.
SERVER_ONLY = re.compile(
    r"TRIM_(DATABASE_URL|MIGRATION_DATABASE_URL|PROXY_SECRET|IP_HASH_PEPPER|TURNSTILE_SECRET|"
    r"RESEND_API_KEY|FDC_API_KEY|VAPID_PRIVATE_KEY|JOB_TOKEN)|PROXY_SECRET"
)
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".pdf", ".xpt"}
SKIP_FILES = {"uv.lock", "package-lock.json"}


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    kind: str

    def __str__(self) -> str:
        return f"{self.path}:{self.line}: {self.kind}"


def tracked_files(root: Path = ROOT) -> list[Path]:
    git = shutil.which("git")
    if git is None:
        raise SystemExit("secret grep needs git to list the tracked files")
    out = subprocess.run(  # noqa: S603 (fixed arguments, no input)
        [git, "ls-files", "-z"], cwd=root, check=True, capture_output=True, text=True
    ).stdout
    return [root / p for p in out.split("\0") if p]


def scan_text(path: str, text: str, bundle: bool = False) -> list[Finding]:
    found: list[Finding] = []
    for n, line in enumerate(text.splitlines(), start=1):
        if ALLOW in line:
            continue
        for kind, pattern in PATTERNS:
            if pattern.search(line):
                found.append(Finding(path, n, kind))
        if bundle and SERVER_ONLY.search(line):
            found.append(Finding(path, n, "server-only setting in the built site"))
    return found


def scan(files: Iterable[Path], root: Path, bundle: bool = False) -> list[Finding]:
    found: list[Finding] = []
    for f in files:
        rel = f.relative_to(root).as_posix() if f.is_relative_to(root) else str(f)
        name = f.name
        if name.startswith(".env") and name != ".env.example":
            found.append(Finding(rel, 0, "an .env file is committed"))
            continue
        if f.suffix.lower() in SKIP_SUFFIXES or name in SKIP_FILES or not f.is_file():
            continue
        try:
            text = f.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        found += scan_text(rel, text, bundle)
    return found


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("paths", nargs="*", type=Path, help="folders to scan (default: git)")
    parser.add_argument("--bundle", action="store_true", help="the paths are a built site")
    args = parser.parse_args(argv)
    if args.paths:
        files = [p for d in args.paths for p in (d.rglob("*") if d.is_dir() else [d])]
        found = scan(files, ROOT, bundle=args.bundle)
    else:
        found = scan(tracked_files(), ROOT)
    for f in found:
        print(f, file=sys.stderr)
    if found:
        print(f"secret grep: {len(found)} finding(s)", file=sys.stderr)
        return 1
    print("secret grep: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
