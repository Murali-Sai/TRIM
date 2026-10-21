#!/usr/bin/env bash
# Restore drill (task 5.6): decrypt a backup, restore it into an empty scratch database and
# check it against its manifest. Exits non-zero on any difference.
#
#   TARGET_URL=postgresql://owner:...@host/scratch AGE_IDENTITY=/path/key.txt \
#     ops/restore-drill.sh trim-2026-10-21T0717Z.tar.age
#
# The target must be empty. The app's roles (trim_app, and a login in it) are created first,
# as on a new server, so the restored grants and RLS policies apply exactly as before.
set -euo pipefail

: "${TARGET_URL:?TARGET_URL is an empty scratch database (owner connection string)}"
: "${AGE_IDENTITY:?AGE_IDENTITY is the age private key file}"
BACKUP="${1:?usage: restore-drill.sh BACKUP.tar.age}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
PSQL="${PSQL:-psql}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

work="$(mktemp -d)"
chmod 700 "$work"
trap 'rm -rf "$work"' EXIT

age -d -i "$AGE_IDENTITY" "$BACKUP" | tar -C "$work" -xf -
manifest="$work/manifest.json"
[ "$(sha256sum "$work/dump.pgc" | cut -d' ' -f1)" = "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["dump_sha256"])' "$manifest")" ] \
  || { echo "restore drill: the dump does not match its checksum"; exit 1; }

tables="$($PSQL "$TARGET_URL" -Atq -c "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[ "$tables" = "0" ] || { echo "restore drill: the target database is not empty"; exit 1; }

$PSQL "$TARGET_URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/db/init/01-roles.sql"
$PG_RESTORE --no-owner --exit-on-error --single-transaction --dbname="$TARGET_URL" "$work/dump.pgc"

# Compare: schema version, every table's row count, and RLS still on where it was.
counts="$($PSQL "$TARGET_URL" -Atq -v ON_ERROR_STOP=1 <<'SQL'
SELECT coalesce(json_object_agg(t, n ORDER BY t), '{}') FROM (
  SELECT c.relname AS t,
         (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text::bigint AS n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r'
) x
SQL
)"
rls="$($PSQL "$TARGET_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT coalesce(json_agg(relname ORDER BY relname), '[]') FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity")"
version="$($PSQL "$TARGET_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT version_num FROM alembic_version")"

python3 - "$manifest" "$version" "$counts" "$rls" <<'PY'
import json, sys
manifest = json.load(open(sys.argv[1]))
version, counts, rls = sys.argv[2], json.loads(sys.argv[3]), json.loads(sys.argv[4])
problems = []
if version != manifest["alembic_version"]:
    problems.append(f"schema {version}, expected {manifest['alembic_version']}")
for table, n in manifest["row_counts"].items():
    if counts.get(table) != n:
        problems.append(f"{table}: {counts.get(table)} rows, expected {n}")
missing = sorted(set(manifest["rls_tables"]) - set(rls))
if missing:
    problems.append(f"RLS off on {', '.join(missing)}")
if problems:
    print("restore drill FAILED:\n  " + "\n  ".join(problems))
    sys.exit(1)
total = sum(manifest["row_counts"].values())
print(f"restore drill passed: schema {version}, {len(counts)} tables, {total} rows, "
      f"RLS on {len(rls)} tables (backup made {manifest['made_at']})")
PY
