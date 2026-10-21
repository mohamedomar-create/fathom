#!/usr/bin/env bash
# Persona test run on a disposable local stack (never production):
#   1. fresh local Supabase   2. production build   3. server with its log captured
#   4. 50 personas            5. one Markdown report of every issue (docs/PERSONA_TEST_ISSUES.md)
#   SKIP_STACK=1 / SKIP_BUILD=1 reuse what is already running or built.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=test-results/personas
rm -rf "$OUT"; mkdir -p "$OUT"
[ "${SKIP_STACK:-}" = 1 ] || bash scripts/local-supabase/start.sh
set -a; . .local-supabase/env; set +a
[ "${SKIP_BUILD:-}" = 1 ] || npx next build
fuser -k 3100/tcp 2>/dev/null || true
npm run start -- -p 3100 > "$OUT/server.log" 2>&1 &
for _ in $(seq 60); do curl -sf -o /dev/null http://localhost:3100/login && break; sleep 1; done
wc -c < .local-supabase/logs/postgres.log > "$OUT/pg.offset"
for u in / /login /demo/summary /demo/sales /privacy; do curl -s -o /dev/null "http://localhost:3100$u"; done
START=$(date +%s)
PERSONAS=1 npx playwright test -c playwright.personas.config.ts "$@" 2>&1 | tee "$OUT/playwright.log"
echo $(( $(date +%s) - START )) > "$OUT/duration"
tail -c +"$(( $(cat "$OUT/pg.offset") + 1 ))" .local-supabase/logs/postgres.log > "$OUT/postgres.log"
cp .local-supabase/logs/imports.log "$OUT/imports.log" 2>/dev/null || true
fuser -k 3100/tcp 2>/dev/null || true
node scripts/personas/report.mjs
