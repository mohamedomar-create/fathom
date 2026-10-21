# Stabilisation (20 Oct 2026): hangs, timeouts, false empty states

- **Branch:** `claude/stabilize-aql360`, cut from `02cdbe2`. That was the head of the production branch `claude/sharp-pasteur-ms9hn6` when this work started; the audited SHA `6569934` was one commit older.
- **Production app:** released on 21 Oct. `claude/sharp-pasteur-ms9hn6` was fast-forwarded to `d166eac` after CI run 121 passed every job, and Vercel reported the deployment as successful.
- **Production database:** migrations 0032, 0033 and 0034 were pasted by the owner on 21 Oct and checked read-only afterwards (see "Live verification").

## Baseline (read-only, live project)

**Database state**
- Migrations 0029–0031 are live: their functions exist with `search_path=''` and security definer.
- The live definitions of `sales_summary`, `expense_summary`, `expense_summary_of`, `payments_summary`, `inventory_state`, `company_balances` and `restamp_expense_classes` are byte-identical to the repository (md5 of `pg_get_functiondef`, live against local).
- Cron jobs: `ireport-imports` and `ireport-inventory-rollups`, each every 5 s.

**Database logs, last 24 h**

| RPC | Calls | HTTP 500 |
|---|---|---|
| expense_summary | 200 | 111 |
| sales_summary | 204 | 83 |
| payments_summary | 70 | 13 |
| inventory_state | 79 | 9 |
| company_balances | 420 | 5 |
| restamp_expense_classes | 3 | 3 |

There were bursts of "canceling statement due to statement timeout" (SQLSTATE 57014).

**Timed live, as a signed-in member inside a read-only transaction, on the largest company:**
- `expense_summary`: 2.96 s;
- `sales_summary`, `inventory_state` and `payments_summary` together: 1.82 s;
- `company_balances`: 0.41 s.

The signed-in statement limit is 8 s. Several pages and section layouts ask for 2–4 of these summaries at the same moment.

## Issue ledger

| ID | Sev | Workflow | Evidence | Root cause | Fix | Verification | Status |
|---|---|---|---|---|---|---|---|
| S1 | Critical | Every Sales, Expenses, Payments and Data page on a large company | 57014 and HTTP 500 in the live logs; reproduced locally: 16 concurrent summary calls under the 8 s limit, **16/16 failed** | Each page view re-adds every line (~60k expense lines): medians, a duplicate-bill self-join, sorts. Concurrent calls pass 8 s | Migration **0032**: summaries kept ready. Line changes mark the company; a background worker rebuilds the summary after a 3 s settle, one at a time under an advisory lock; pages read one row through `summary_state` (status, built time, error). Old functions unchanged | Same local test: **0/48 failed** (48 concurrent reads, slowest 4.8 s with ~10 MB of JSON each). DB test: identical output to the old functions after upload, restamp, undo and clear (rows compared as sets; jsonb_agg has no order). Idle worker cost 3 ms per tick | Fixed, live |
| S2 | Critical | Financial integrity | `sales-load.ts`, `expenses-load.ts` and `payments-load.ts` returned EMPTY after an error, so pages showed "No sales loaded" and upload prompts | Errors were swallowed into the empty value | Loaders return `Loaded<T>`: ready, empty, pending, stale or failed. Section layouts gate on it: failed gives a retry and a reference; pending refreshes itself for up to 2 min; stale shows a note with the time. Data Steps and Readiness say "couldn't be checked". Inventory, Reports and Data checks name the dependency that failed. AI commentary refuses (503) instead of writing from zeros | Unit tests (`summary-state`, `data-steps`, `readiness`); e2e `failure-states.spec.ts` injects 57014 for one company: failed, stale, pending, then retry recovers, and `no-sales` never appears | Fixed |
| S3 | High | Authorization | `load.ts`: `readOnly: mem?.role === "viewer"` but `role: mem?.role ?? "viewer"`, and membership errors were discarded | A failed or missing membership showed edit controls | `access.ts`, fail-closed: a read error throws to the section's error screen, no membership gives not found, `readOnly` comes from the real role. A company read error is an error, not "not found". Same in `meta.ts` | `tests/unit/access.test.ts`; e2e viewer test | Fixed |
| S4 | High | Reports | "Create report" disabled while figures were visible | The page read `account_balances` with a join and treated a slow or failed read as "no data"; viewers got no reason | Reads the same bundle the pages use; gives an exact reason (view-only, or no figures for version N with a link to Data ▸ Steps); a failed list says so | e2e (viewer sees "View-only") | Fixed |
| S5 | High | Import and class changes | `restamp_expense_classes` 500 three times out of three live | The planner ran the per-account class lookup once per line: 31k calls, 5.1 s locally on the bench company | Migration **0033**: the class lookup runs once per distinct account (`materialized`) | 5.1 s → 25 ms on the same data; DB suite green | Fixed, live |
| S6 | Medium | Navigation | Reports list: 722 KB download, page frozen 380 ms | The Reports layout loaded the full sales and expense summaries for the list page too | They load only for an open report (`components/report/report-data.tsx`) | Speed test: 1.24 s → 0.42–0.49 s, 83 KB, no long task | Fixed |
| S7 | Medium | Errors | HTTP 200 pages hid downstream failures; no `error.tsx` under `/company` | — | `error.tsx` per company section (menus kept, digest as reference). Structured `kind:"op"` log line per summary read: op, company hash, ms, attempts, outcome, SQL code, ref | Build; e2e | Fixed |
| S8 | Medium | Retries | No retry policy | — | One bounded retry, jittered 300–600 ms, on 57014, 55P03, 53300, 08xxx, PGRST00x, 502–504 or network errors (`observe.ts`). The retry button is disabled while running. Pending refresh stops after 2 min | Unit + e2e | Fixed |
| S9 | Low | Rate limits | A viewer's clear or invite attempt counted against the editors' or admins' allowance | The rate limit was counted before the role check | The role is checked first in `clearData`, `clearLedgerLines` and `invite`; a refused report delete is logged | Code review + e2e viewer test | Fixed |
| S10 | Low | Navigation | Company card "Settings" went to `/data`; inside the company it goes to `/settings/profile` | — | Card: "Data" → `/data` and "Settings" → `/settings/profile` | e2e crawl | Fixed |
| S11 | Low | Portfolio | "Avg GPM" was a plain mean of margins with no label | — | Labelled "Simple avg" with a tooltip; margins also show "Group" = total profit ÷ total revenue (same currency only) | Typecheck + e2e | Fixed |
| S12 | CI | E2E job 118758912978 | `[mobile] demo.spec.ts:283`: locator resolved to a hidden element | Test fault: `.or(...).first()` picked the top-bar tab, which is hidden on phones; the sector chips were visible | Waits for the visible one | Public e2e 130/130 on desktop and mobile | Fixed |
| S13 | Info | CI | Node 20 deprecation warning on GitHub actions | Not the cause of S12 | Not changed: `actions/*@v4` run on Node 24 as forced by the runner. Bump to Node 24 action majors when they are published | — | Recorded |
| S14 | Medium | Rate limits | `rate_limit_hit` let any member of a company or organisation count against shared scopes (`reset`, `invite`, `ai_company`, `pdf_read_company`) | SQL checked membership only | Migration **0034**: company scopes need an editor, the organisation scope (invites) an admin; user and visitor scopes unchanged | `supabase/tests/rate_limit_roles.sql` (6 checks) | Fixed, live |
| S15 | Low | Delete company | `settings/actions:deleteCompany` deleted the row directly, skipping the stored-file cleanup and the deletion record that `deleteCompanyFully` does | Two delete paths | `deleteCompany` now uses `deleteCompanyFully` whenever migration 0031 is live (it is); the plain delete remains only for a database without 0031 | e2e company deletion | Fixed |
| S16 | Info | Layout | `company/[id]/layout.tsx` waits for the company bundle | Measured: `company_balances` 103 ms (361 ms at 16 at once) locally and 405 ms live; `loading.tsx` shows at once | Not split: not the bottleneck once S1 is fixed | — | Not needed |
| S17 | Info | Authorization survey | Every server action and API write surveyed | Each write requires editor or admin in code, in the database function, or in row security; no service-role client in `src` | — | e2e: a viewer's clear, settings change and batch delete are refused; a stranger's `summary_state` call gets 403 | Verified |

## Live verification (21 Oct, read-only, after the owner pasted 0032–0034)

- **Objects:** `summary_state` exists; `summary_rollups` has RLS on; signed-out visitors cannot run `summary_state`; cron job `ireport-summary-rollups` is active, 62 runs, 0 failures.
- **Rollups:** 5 built (sales and expenses for two companies, payments for one), none with an error, each built at its latest mark.
- **Same figures:** for the largest company, signed in as a member inside a read-only transaction, `summary_state` returned `ready` for sales, expenses and payments, and each summary is byte-identical (md5) to the old `sales_summary`, `expense_summary` and `payments_summary`.
- **Speed:** the three `summary_state` reads together took 0.30 s, against 2.96 s for `expense_summary` alone and 1.82 s for the other summaries measured on 20 Oct.
- **0033:** `restamp_expense_classes` carries the `materialized` lookup. **0034:** `rate_limit_hit` carries the editor and admin checks.
- **Timeouts:** the postgres log shows 152 statement timeouts on 20 Oct (18:00–19:59 UTC) and none since. Little traffic has reached the site since the release, so this is not yet proof under load; the next busy hours are the real test.
- **Not checked:** aql360.com itself cannot be reached from this session.

## Measurements (local stack under the live limits: 8 s signed-in statements, jit off, 4 CPUs)

**Data:** the bench company, 150 accounts × 64 months, ~31k expense lines, 17k sales lines, 22k payments (`scripts/bench/seed-big.sql`).

| | Before (02cdbe2) | After (this branch) |
|---|---|---|
| 16 summary reads at once | 16 failed (57014) | 0 failed (48 at once: 0 failed) |
| Sales page | 1.93 s | 1.15–1.51 s |
| Expenses page | 1.49 s | 1.00–1.13 s |
| Payments page | 1.39 s | 1.15–1.31 s |
| Reports list | 1.24 s, 722 KB, 228–384 ms freeze | 0.42–0.49 s, 83 KB, no freeze |
| Navigation, warm p95 (54 visits) | 1.74 s | 1.28 s |
| Navigation, cold first visit (max) | 1.99 s | 1.46 s |
| restamp_expense_classes | 5.1 s | 25 ms |

**The live project will differ.** It has a smaller compute instance and real network latency, and the concurrency failures happen there, not here at single-user load. Re-measure on the preview, and on production after the release.

**Targets:**
- warm p95 ≤ 2 s: **met locally** (1.28 s);
- cold ≤ 4 s: **met locally** (1.46 s);
- not yet measured on live infrastructure.

## Tests run (this branch, final)

| Command | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (1 old warning) |
| `npm test` | 905 passed |
| `scripts/test-db.sh` | 385 checks passed, 22 new in `summary_rollups.sql` and 6 in `rate_limit_roles.sql` |
| `npx next build` | ok |
| `npx playwright test tests/e2e` (desktop and mobile) | 130 passed |
| `E2E_AUTH=1 … tests/e2e-auth --project=desktop` | 40 passed, 4 of them new in `failure-states.spec.ts` |
| `SPEED=1 … speed.spec.ts` | 3 passed |

## Workflow coverage

**Covered by automated tests** (pass on this branch):
- sign-up and sign-in, sign-out, roles and invites (`access.spec`);
- companies, upload wizard and preflight, General Ledger, TB check, sales, expenses, stock, payments and ageing (`pathways.spec`);
- clear and delete on made-up companies (`reset-preflight.spec`);
- end users and agency statement;
- every-route crawl;
- RLS against strangers;
- failure, stale and pending states;
- viewer refusals;
- speed.

**Not tested here (needs access I don't have, or real data):**
- the Vercel preview behaviour and logs (no Vercel access from this session; the preview link comes from the GitHub deployment status);
- real Odoo live sync;
- PDF rendering on Vercel;
- session expiry against the production auth settings;
- slow-network and offline transitions: only the retry logic is unit-tested, with no throttled-browser run;
- alerting: no log drain or alert service is reachable.

  **Saved query for Vercel logs:** `kind:"op" outcome:"failed"`.

  **Read-only SQL for 57014 per function per hour:**

  ```sql
  select date_trunc('hour', timestamp), count(*) from logs where source='postgres_logs' and event_message like '%statement timeout%' group by 1
  ```

  This runs in the Supabase log explorer.

## Release (done 21 Oct: app at d166eac, migrations pasted by the owner)

1. **Database, in the Supabase SQL editor.** Paste `supabase/migrations/0032_summary_rollups.sql`, then `0033_restamp_fast.sql`, then `0034_rate_limit_roles.sql`.
   - **0032:** adds tables, functions, triggers and one cron job (`ireport-summary-rollups`, every 5 s), and marks every company so its summaries build within seconds.
   - **0033:** replaces one function with the same rules.
   - **0034:** replaces `rate_limit_hit` with role checks.
   - All three only add or replace. The current production app keeps working, because it never calls `summary_state`.
2. **Check, read-only:**
   - `summary_rollups` has a row per company and kind with `error` null;
   - `summary_state` for the largest company equals `expense_summary` and `sales_summary`, compared as sets;
   - signed-out visitors can't call it.
3. **Merge `claude/stabilize-aql360` into `claude/sharp-pasteur-ms9hn6`.** Vercel deploys production. Required before the merge: CI green (typecheck, lint, unit, DB, build, both e2e suites).
4. **Watch for an hour.** Postgres 57014 count; Vercel `kind:"op"` failures.

**Order matters only for speed, not for correctness.** The new app works before 0032: `summary_state` missing (PGRST202) falls back to the old functions, with explicit failed and stale states.

**Recovery:**
- **App:** revert the merge commit. The old app ignores the new objects.
- **Database:** paste `supabase/rollback/0032_summary_rollups_down.sql`. It unschedules the job and drops the triggers, the two tables and the new functions; no data is touched.
- **0033:** to revert, re-paste the function body from `0023_expense_classes_by_chart.sql`. Not expected to be needed, since the result is identical.
- **0034:** to revert, re-paste `rate_limit_hit` from `0025_odoo_security.sql`.

## Remaining risks

- **Brief load after an upload:** right after one, the page adds the summary up live once while the worker rebuilds. A very large company can still time out in that window. It then shows the previous figures marked "updating", or the waiting screen, never zero.
- **First-ever build:** the worker rebuilds one company and kind at a time (≤ 3 per 5 s tick). After pasting 0032, the largest company's three summaries need a few ticks. Meanwhile pages fall back as above.
- **In-memory "last good copy":** it is per server instance, so a fresh serverless instance has no copy to show as stale. It shows "failed" with a retry instead.
