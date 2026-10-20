#!/bin/sh
# Calls the page summaries N at a time as the signed-in bench user under the live 8 s limit, and reports how many failed
# and the slowest call. Local stack only. Usage: concurrent-summaries.sh [N] [sql-per-call]
N="${1:-8}"
DB="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
CALL="${2:-select length(public.expense_summary('00000000-0000-0000-0000-0000000000c1')::text), length(public.sales_summary('00000000-0000-0000-0000-0000000000c1')::text)}"
T=$(mktemp -d)
i=0
while [ "$i" -lt "$N" ]; do
  ( s=$(date +%s%N)
    if psql "$DB" -Atq -c "set role authenticated" -c "select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-0000-0000-00000000b16b\"}',false)" -c "set statement_timeout='8s'" -c "$CALL" >/dev/null 2>"$T/err$i"; then r=ok; else r=failed; fi
    echo "$r $(( ($(date +%s%N) - s) / 1000000 ))" > "$T/out$i" ) &
  i=$((i + 1))
done
wait
cat "$T"/out* | awk '{ if ($1=="failed") f++; if ($2>m) m=$2 } END { printf "calls=%d failed=%d slowest_ms=%d\n", NR, f, m }'
grep -h "ERROR" "$T"/err* | sort | uniq -c | head -3
rm -rf "$T"
