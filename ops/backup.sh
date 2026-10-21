#!/usr/bin/env bash
# Nightly backup (task 5.6): dump the database, describe it, encrypt both with age.
#
#   SOURCE_URL=postgresql://owner:...@host/db AGE_RECIPIENTS="age1... age1..." \
#     ops/backup.sh /path/to/out-dir
#
# Writes <out>/trim-<UTC date and time>.tar.age holding:
#   dump.pgc       pg_dump custom format (schema, data, RLS policies and grants; no owners)
#   manifest.json  schema version, exact row counts per table, tables with RLS on, dump sha256
# Only the age recipients' private keys can read it. Nothing is written unencrypted outside a
# private temporary folder that is removed on exit.
set -euo pipefail

: "${SOURCE_URL:?SOURCE_URL is the database to back up (an owner connection string)}"
: "${AGE_RECIPIENTS:?AGE_RECIPIENTS is one or more age public keys}"
OUT_DIR="${1:?usage: backup.sh OUT_DIR}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PSQL="${PSQL:-psql}"

work="$(mktemp -d)"
chmod 700 "$work"
trap 'rm -rf "$work"' EXIT

stamp="$(date -u +%Y-%m-%dT%H%MZ)"
$PG_DUMP --format=custom --no-owner --compress=6 --file="$work/dump.pgc" "$SOURCE_URL"

# Exact counts, not estimates, so the drill can prove nothing was lost.
counts="$($PSQL "$SOURCE_URL" -Atq -v ON_ERROR_STOP=1 <<'SQL'
SELECT coalesce(json_object_agg(t, n ORDER BY t), '{}') FROM (
  SELECT c.relname AS t,
         (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', c.relname), false, true, '')))[1]::text::bigint AS n
  FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r'
) x
SQL
)"
rls="$($PSQL "$SOURCE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT coalesce(json_agg(relname ORDER BY relname), '[]') FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace WHERE ns.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity")"
version="$($PSQL "$SOURCE_URL" -Atq -v ON_ERROR_STOP=1 -c "SELECT version_num FROM alembic_version")"
sha="$(sha256sum "$work/dump.pgc" | cut -d' ' -f1)"
cat > "$work/manifest.json" <<JSON
{"made_at": "$stamp", "alembic_version": "$version", "dump_sha256": "$sha", "row_counts": $counts, "rls_tables": $rls}
JSON

args=()
for r in $AGE_RECIPIENTS; do args+=(-r "$r"); done
mkdir -p "$OUT_DIR"
out="$OUT_DIR/trim-$stamp.tar.age"
tar -C "$work" -cf - dump.pgc manifest.json | age "${args[@]}" -o "$out"
echo "$out"
