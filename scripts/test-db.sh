#!/bin/sh
# Applies every migration to a throwaway local Postgres and runs the SQL tests in supabase/tests.
# Needs a running Postgres you can reach as a superuser, e.g. DB_URL=postgres://postgres@localhost:54329/postgres
set -e
cd "$(dirname "$0")/.."
DB_URL="${DB_URL:-postgres://postgres@localhost:5432/postgres}"
TEST_DB="${TEST_DB:-ireport_test}"
psql "$DB_URL" -q -c "drop database if exists $TEST_DB" -c "create database $TEST_DB"
# The settings of a small Supabase project, so the timing checks mean the same as on the live site.
psql "$DB_URL" -q -c "alter database $TEST_DB set jit = off" -c "alter database $TEST_DB set work_mem = '2184kB'" -c "alter database $TEST_DB set max_parallel_workers_per_gather = 1"
T=$(echo "$DB_URL" | sed "s#/[^/]*\$#/$TEST_DB#")
psql "$T" -q -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql "$T" -q -v ON_ERROR_STOP=1 -f "$f"; done
# Every company check must ask the company (company_can), never only the organisation. Checked here, after the
# migrations and before any test re-runs one, so a later migration that forgets `select private.adopt_company_roles();`
# fails CI instead of being fixed up by a test.
left=$(psql "$T" -At -c "select string_agg(x, ', ') from (select p.oid::regprocedure::text x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.prosrc like '%is_member(private.' || 'company_org(%' union all select policyname from pg_policies where coalesce(qual, '') || coalesce(with_check, '') like '%is_member(private.' || 'company_org(%') t")
if [ -n "$left" ]; then echo "Company checks still asking the organisation (end the migration with select private.adopt_company_roles();): $left"; exit 1; fi
for f in supabase/tests/*.sql; do
  case "$f" in */00_*) continue ;; esac
  echo "== $f"
  if ! out=$(psql "$T" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then echo "$out"; exit 1; fi
  echo "$out" | sed -n 's/^.*NOTICE:  //p'
done
psql "$DB_URL" -q -c "drop database $TEST_DB"
