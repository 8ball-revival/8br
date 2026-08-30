#!/usr/bin/env bash
#
# A content fingerprint of every table in a local database.
#
# Row counts alone do not prove data is unchanged -- an UPDATE keeps the count identical. So each
# table is also hashed: every row rendered as JSON, sorted by that JSON text, and the stream md5'd.
# Sorting by the text rather than by a key means the hash does not depend on physical row order,
# which pg_restore and VACUUM are both free to change.
#
# The whole thing runs server-side in one statement. Building the per-table SQL in the shell meant
# passing identifiers back through bash quoting, where "payload"."x" collapsed into the single
# identifier "payload.x" and every table came back as "does not exist". format('%I') has no such
# layer to lose anything in.
#
# Timezone is pinned to UTC: timestamptz renders in the session zone, so a machine that changed
# zone between two runs would otherwise report every dated table as different.
#
# Usage: scripts/db/fingerprint.sh "<connection-url>" > before.txt
set -euo pipefail

URL="${1:?usage: fingerprint.sh <connection-url>}"
PSQL="${PSQL_BIN:-/c/Program Files/PostgreSQL/17/bin/psql.exe}"
export PGOPTIONS="-c timezone=UTC"

"$PSQL" -Atq -v ON_ERROR_STOP=1 "$URL" <<'SQL'
DO $fp$
DECLARE
  r  record;
  n  bigint;
  h  text;
BEGIN
  FOR r IN
    SELECT table_schema AS s, table_name AS t
      FROM information_schema.tables
     WHERE table_schema IN ('public', 'payload') AND table_type = 'BASE TABLE'
     ORDER BY table_schema, table_name
  LOOP
    EXECUTE format(
      'SELECT count(*), coalesce(md5(string_agg(j, E''\n'' ORDER BY j)), ''empty'')
         FROM (SELECT row_to_json(x)::text AS j FROM %I.%I x) s', r.s, r.t)
      INTO n, h;
    RAISE INFO '%', rpad(r.s || '.' || r.t, 46) || lpad(n::text, 9) || '  ' || h;
  END LOOP;
END
$fp$;
SQL
