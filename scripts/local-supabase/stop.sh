#!/usr/bin/env bash
# Stops the local Supabase started by start.sh.
cd "$(dirname "$0")/../.."
ROOT="$PWD/.local-supabase"
for s in imports gateway postgrest auth; do [ -f "$ROOT/$s.pid" ] && kill "$(cat "$ROOT/$s.pid")" 2>/dev/null; rm -f "$ROOT/$s.pid"; done
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
AS=(); if [ "$(id -u)" = 0 ]; then AS=(runuser -u postgres --); fi
[ -d "$ROOT/pgdata" ] && "${AS[@]}" "$PG_BIN/pg_ctl" -D "$ROOT/pgdata" -m fast stop >/dev/null 2>&1
exit 0
