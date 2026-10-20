#!/usr/bin/env bash
# A local Supabase without Docker: Postgres + GoTrue (auth) + PostgREST (API) behind a small gateway (which also stands in
# for Storage's resumable uploads), and a loop that runs the import worker every 2 seconds (pg_cron does it in Supabase).
# Used by the signed-in browser tests locally and in CI. Writes the URL and keys to .local-supabase/env.
#   scripts/local-supabase/start.sh   # start (fresh database every time)
#   scripts/local-supabase/stop.sh    # stop
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="$PWD/.local-supabase"
POSTGREST_VERSION=v13.0.4
AUTH_VERSION=v2.186.0
PG_PORT=54322 GW_PORT=54321 REST_PORT=54330 AUTH_PORT=54331
JWT_SECRET="local-only-jwt-secret-at-least-32-characters-long"
mkdir -p "$ROOT/bin" "$ROOT/logs"

# --- binaries (cached between runs)
if [ ! -x "$ROOT/bin/postgrest" ]; then
  curl -fsSL "https://github.com/PostgREST/postgrest/releases/download/$POSTGREST_VERSION/postgrest-$POSTGREST_VERSION-linux-static-x86-64.tar.xz" | tar -xJ -C "$ROOT/bin"
fi
if [ ! -x "$ROOT/bin/auth" ]; then
  curl -fsSL "https://github.com/supabase/auth/releases/download/$AUTH_VERSION/auth-$AUTH_VERSION-x86.tar.gz" | tar -xz -C "$ROOT/bin"
fi
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/initdb" ] || { echo "Postgres binaries not found (set PG_BIN)"; exit 1; }

"$(dirname "$0")/stop.sh" >/dev/null 2>&1 || true

# --- a fresh Postgres cluster (initdb refuses to run as root, so use the postgres user there)
AS=(); if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); fi
PGDATA="$ROOT/pgdata"
# The settings of a small Supabase project (checked on the live database), so timings here mean the same as there.
PG_LIKE_SUPABASE="-c jit=off -c work_mem=2184kB -c shared_buffers=224MB -c max_parallel_workers_per_gather=1"
rm -rf "$PGDATA"; mkdir -p "$PGDATA"; [ ${#AS[@]} -gt 0 ] && chown -R postgres "$PGDATA" "$ROOT/logs"
"${AS[@]}" "$PG_BIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 >/dev/null
"${AS[@]}" "$PG_BIN/pg_ctl" -D "$PGDATA" -o "-p $PG_PORT -k /tmp -c listen_addresses=127.0.0.1 $PG_LIKE_SUPABASE" -l "$ROOT/logs/postgres.log" -w start >/dev/null
DB="postgres://postgres@127.0.0.1:$PG_PORT/postgres"
psql "$DB" -q -v ON_ERROR_STOP=1 -f scripts/local-supabase/bootstrap.sql

# --- GoTrue creates the auth schema (auth.users, auth.uid() …), then our migrations run on top
export GOTRUE_DB_DRIVER=postgres
export GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:local-auth-admin@127.0.0.1:$PG_PORT/postgres"
export GOTRUE_DB_MIGRATIONS_PATH="$ROOT/bin/migrations"
export GOTRUE_API_HOST=127.0.0.1 GOTRUE_API_PORT=$AUTH_PORT PORT=$AUTH_PORT
export API_EXTERNAL_URL="http://127.0.0.1:$GW_PORT/auth/v1"
export GOTRUE_SITE_URL="${SITE_URL:-http://localhost:3100}" GOTRUE_URI_ALLOW_LIST="${SITE_URL:-http://localhost:3100}/**"
export GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role
export GOTRUE_DISABLE_SIGNUP=false GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_PASSWORD_MIN_LENGTH=10
export GOTRUE_RATE_LIMIT_TOKEN_REFRESH=10000 GOTRUE_RATE_LIMIT_VERIFY=10000 GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS=10000
export GOTRUE_LOG_LEVEL=warn
"$ROOT/bin/auth" migrate > "$ROOT/logs/auth-migrate.log" 2>&1
for f in supabase/migrations/*.sql; do psql "$DB" -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null; done

# --- services
nohup "$ROOT/bin/auth" serve > "$ROOT/logs/auth.log" 2>&1 & echo $! > "$ROOT/auth.pid"
PGRST_DB_URI="postgres://authenticator:local-authenticator@127.0.0.1:$PG_PORT/postgres" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
  PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=$REST_PORT PGRST_SERVER_HOST=127.0.0.1 PGRST_DB_POOL=10 \
  nohup "$ROOT/bin/postgrest" > "$ROOT/logs/postgrest.log" 2>&1 & echo $! > "$ROOT/postgrest.pid"
rm -rf "$ROOT/storage"; mkdir -p "$ROOT/storage"
nohup node scripts/local-supabase/gateway.mjs $GW_PORT $AUTH_PORT $REST_PORT "$ROOT/storage" > "$ROOT/logs/gateway.log" 2>&1 & echo $! > "$ROOT/gateway.pid"
nohup sh -c "while true; do psql '$DB' -q -c 'call private.run_import_jobs()' -c 'select private.refresh_inventory_rollups()' -c 'select private.refresh_summary_rollups()' >/dev/null 2>>'$ROOT/logs/imports.log'; sleep 2; done" > /dev/null 2>&1 & echo $! > "$ROOT/imports.pid"

for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$GW_PORT/auth/v1/health" >/dev/null 2>&1 && curl -fsS -o /dev/null "http://127.0.0.1:$REST_PORT/" 2>/dev/null; then break; fi
  sleep 0.5
  [ "$i" = 60 ] && { echo "local Supabase did not start; see $ROOT/logs"; tail -20 "$ROOT"/logs/*.log; exit 1; }
done
{ echo "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$GW_PORT"; node scripts/local-supabase/keys.mjs "$JWT_SECRET" | sed 's/^ANON_KEY=/NEXT_PUBLIC_SUPABASE_ANON_KEY=/'; echo "LOCAL_DB_URL=$DB"; } > "$ROOT/env"
echo "local Supabase ready on http://127.0.0.1:$GW_PORT (env in .local-supabase/env)"
