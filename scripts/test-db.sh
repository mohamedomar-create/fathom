#!/bin/sh
# Applies every migration to a throwaway local Postgres and runs the SQL tests in supabase/tests.
# Needs a running Postgres you can reach as a superuser, e.g. DB_URL=postgres://postgres@localhost:54329/postgres
set -e
cd "$(dirname "$0")/.."
DB_URL="${DB_URL:-postgres://postgres@localhost:5432/postgres}"
TEST_DB="${TEST_DB:-ledgerlens_test}"
psql "$DB_URL" -q -c "drop database if exists $TEST_DB" -c "create database $TEST_DB"
T=$(echo "$DB_URL" | sed "s#/[^/]*\$#/$TEST_DB#")
psql "$T" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql "$T" -q -v ON_ERROR_STOP=1 -f "$f"; done
for f in supabase/tests/*.sql; do
  case "$f" in */00_*) continue ;; esac
  echo "== $f"
  if ! out=$(psql "$T" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then echo "$out"; exit 1; fi
  echo "$out" | sed -n 's/^.*NOTICE:  //p'
done
psql "$DB_URL" -q -c "drop database $TEST_DB"
