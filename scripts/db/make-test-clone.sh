#!/usr/bin/env bash
#
# Clone the local development database into a disposable copy for a mutating suite.
#
# The name must match `8br_test_<something>` — that pattern is what `db-guard` checks before any
# suite that can write is allowed to run, and there is no override. Dropping and recreating first
# means a suite always starts from the same state rather than from whatever the last run left.
#
# Usage: scripts/db/make-test-clone.sh 8br_test_sb
set -euo pipefail

NAME="${1:?usage: make-test-clone.sh <8br_test_name>}"
case "$NAME" in
  8br_test_*) ;;
  *) echo "Refusing: '$NAME' is not a disposable name (8br_test_*)." >&2; exit 1 ;;
esac

BIN="${PG_BIN:-/c/Program Files/PostgreSQL/17/bin}"
SOURCE=$(grep -hoE 'DATABASE_URL="[^"]+"' .env.replica | sed -E 's/DATABASE_URL="//; s/"$//')
ADMIN=$(echo "$SOURCE" | sed -E "s#/[^/?]+(\?|$)#/postgres\1#")
TARGET=$(echo "$SOURCE" | sed -E "s#/[^/?]+(\?|$)#/$NAME\1#")

TMP=$(mktemp)
printf 'DROP DATABASE IF EXISTS "%s";\nCREATE DATABASE "%s";\n' "$NAME" "$NAME" > "$TMP"
"$BIN/psql.exe" -q -v ON_ERROR_STOP=1 "$ADMIN" -f "$TMP"
rm -f "$TMP"

DUMP=$(mktemp).dump
"$BIN/pg_dump.exe" -Fc --no-owner --no-privileges "$SOURCE" -f "$DUMP"
"$BIN/pg_restore.exe" -d "$TARGET" --no-owner --no-privileges "$DUMP" > /dev/null 2>&1 || true
rm -f "$DUMP"

echo "$TARGET"
