# iReport (repo "fathom"): project handoff

Updated 18 Oct 2026. This file is how a new chat picks up the project with nothing lost. A fuller **private** copy also exists, with real company figures, live database facts and where the private test files are kept. The owner holds it. This public copy leaves the company figures out, because the repository is public.

---

## 1. What the app is

**iReport** is a web app that turns a company's accounting data into management analysis:
- financial statements, KPIs, cash flow, forecast and goalseek;
- Banking readiness and Real profit (after inflation, the pound's rate and late customer payments);
- Sales, Expenses and Inventory sections;
- reports with AI commentary and a PDF export;
- English and Arabic, right to left.

Data comes in two ways:
- **Odoo exports** (General Ledger, Trial Balance, P&L, Balance Sheet, invoice lines, vendor bills, and the stock valuation, moves, on-hand and product exports), plus Excel templates and messy workbooks;
- a **read-only live Odoo connection**.

The owner, an Egyptian finance executive, uses it for their own companies:
- **the main company**, held as "the main company", plus an older one-month company "Sample Trading Co";
- **Company B**;
- **Company C**;
- **Company D**;
- a demo company.

## 2. The owner's standing rules (always apply)

1. **Every Odoo is customised.** Two similar companies share Odoo's core, but their fields, templates and charts differ. Read every input with a critical eye. Prove the data consistent in several layers of checks and verification, judged by the most experienced accountant there is. Never trust a column name, a sign or a class blindly.
2. **Never write to Odoo.** The client allows only `search_read`, `read`, `read_group`, `search_count` and `fields_get`.
3. **Real company data never goes into git** (the repository is public). Real files, the private fixture and registers stay in the session scratchpad, or with the owner.
4. **Database changes are numbered migrations** (`supabase/migrations/00NN_*.sql`) that **the owner pastes** into the Supabase SQL editor. The database tool cannot run destructive SQL from these sessions. After a paste, verify read-only.
5. **No pull requests unless asked.** Work on branch `claude/sharp-pasteur-ms9hn6`. Push with `git push -u origin claude/sharp-pasteur-ms9hn6`.
6. **Commit footer**, exactly these two lines:
   - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
   - `Claude-Session: https://claude.ai/code/session_0146uqv4pEgpMyVB26ZFqqX2` (or the new session's link)
7. **No AI model names** in commits, code or docs.
8. **Plain language** to the owner: short sentences, figures tied to their source, no jargon. Every adjustment is disclosed.
9. **Banking reads a calendar year**, 1 Jan – 31 Dec: the latest complete one (owner's decision, 18 Oct).

## 3. Environment

| Item | Value |
|---|---|
| Repo | `mohamedomar-create/fathom` (GitHub, public) |
| Working branch | `claude/sharp-pasteur-ms9hn6` |
| Stack | Next.js 16 (App Router), TypeScript, Tailwind, Supabase (Postgres + RLS + security-definer RPCs), Vercel, vitest, Playwright |
| Supabase project | `iszcsjgwbsulwmnyokpd` |
| CI | `.github/workflows/ci.yml`: typecheck, lint, unit, build, DB tests, public e2e, signed-in e2e |
| Latest CI | run 80 on `3f6ef17`: green |

**Local commands:**
```bash
npx tsc --noEmit -p . && npx eslint src tests --quiet      # typecheck + lint
npx vitest run                                            # unit (≈652 tests)
bash scripts/local-supabase/start.sh                      # local Supabase with the live limits (8 s statements)
psql postgres://postgres:postgres@127.0.0.1:54322/postgres -c "delete from private.rate_events"   # before browser runs
DB_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres bash scripts/test-db.sh               # database tests
npm run e2e          # public browser tests (126)
npm run e2e:auth     # signed-in browser tests (23)
RECON_DIR=<private folder> npx vitest run tests/unit/golden-reconciliation.test.ts   # private real-data check
```

## 4. Architecture map

- **`src/lib/ingest/`**: everything that reads files.
  - `pipeline.ts`: `ingest`/`runIngest` turns raw lines into classified, natural-sign monthly values, with checks. It also holds `applyCutoff`, the opening month and earnings to date.
  - `odoo.ts`: the Odoo General Ledger, Trial Balance and statement readers.
  - `books-start.ts`: books start (go-live) logic.
  - `cutoff.ts`, `classify.ts`, `roles.ts`, `sales.ts`, `expenses.ts`, `inventory.ts`, `odoo-templates.ts`, `layout-profile.ts`, `cashbook.ts`, `bank.ts`.
- **`src/lib/engine/`**: the pure calculations.
  - `statements.ts`, `cashflow.ts`, `kpis.ts`, `analyze.ts` (periods, like-for-like), `basis.ts` (`twelveMonths`), `bank.ts`, `bank-outlook.ts` (`bankPack`, `bankYearEnd`, trend, stress test, pro-forma, memo).
  - `real-profit.ts`, `forecast.ts`, `insights.ts`, `sales.ts`, `expenses.ts`, `inventory.ts`, `tieout.ts`.
- **`src/lib/company/`**:
  - `build.ts` (`buildMonths`);
  - `checks.ts` (check layers: file, identities, continuity, review);
  - `import-plan.ts` (merge, replace, add, timeline, books start);
  - `import-schema.ts`, `load.ts`, `account-map`, `ledger-lines.ts`;
  - `time-zone.ts`: profile settings kept in `companies.kpi_config.profile` (time zone, books from zero, books start).
- **`src/lib/odoo/`**: `client.ts` (read-only allowlist) and `sync.ts` (balances, ledger lines, late postings, books start).
- **`src/lib/imports/`**: background import jobs for large stock files, with a server-side reader.
- **Pages**: `src/app/company/[id]/…`; the upload wizard is `src/components/settings/upload-wizard.tsx`. `src/app/demo/…` is the public demo.
- **Database**: `supabase/migrations/0001–0023`; `supabase/tests/*.sql`.
- **Tests**: `tests/unit` (vitest), `tests/e2e` (public), `tests/e2e-auth` (signed-in).
- **Design docs**: `docs/superpowers/specs/2026-10-15-modules-consistency-design.md` and `docs/superpowers/plans/2026-10-15-inventory-and-tieouts.md`.

## 5. Accounting rules as built

- **Classes:** 30 standard classes (revenue, `cos_variable`, `exp_fixed`, `exp_variable`, `exp_depreciation`, `interest_expenses`, cash, ar, inventory, ap, `retained_earnings`, `other_equity`, …). A person's choice in Chart of accounts is stored in the **account map** (by code) and beats Odoo's account type and every later upload or sync.
- **Movement vs natural lines:** a ledger or TB gives movements; balance-sheet lines become opening + cumulative movement. P&L accounts are never closed in Odoo, so "Earnings to date" is computed into retained earnings.
- **Opening month:** a file's opening balances are stored as the balance sheet of the month before its first month, with no P&L.
- **Books start (go-live), 18 Oct:**
  - every ledger line dated before it goes into the opening balance;
  - pre-start P&L goes to opening retained earnings;
  - no month, sales line or expense line exists before it;
  - suggested from Odoo's "Opening Journal Entry" (the next day, when it falls on a month end);
  - saved in the company profile;
  - used by uploads, the import plan (stored months before it are dropped) and the Odoo sync;
  - postings to the opening-balance account after go-live are flagged for review.
- **Opening balances upload, 18 Oct:**
  - its own card on the upload page (`kind: "opening"`, setup step `?step=opening`), for any company;
  - takes an Odoo GL or TB for the opening day, or the Code | Account | Debit | Credit template;
  - stored as the balance sheet of the as-at month only, with P&L closed into retained earnings; books start = the next day;
  - loaded later, it moves balance-sheet months built from zero (import `report.openingBasis = "zero"`) by each account's opening;
  - without it, uploads still work and balances start from zero, said on the Check step and in Readiness.
- **Cut-off date:** set on every upload, defaulting to the last entry's date. Rows after it are left out and listed. The period label comes from it ("to 15 Oct").
- **Part months:**
  - KPIs use the days covered;
  - like-for-like compares with the same days of the month before (`view.likePrior`);
  - statements show whole prior periods.
- **Banking:**
  - the latest complete calendar year, Jan–Dec, on or before the selected month (`bankYearEnd`);
  - falls back to the selected period when no full year is held;
  - when no tax is booked, tax is taken at the profile rate;
  - the stress test uses the same tax.
- **Inventory:**
  - **Location type:** Odoo's location type when exported, else the company's own list (a person's choice wins). Only internal and transit locations are stock. "Repair" counts only at the top level.
  - **Rental and transit:** counted once.
  - **Cost of sales check:** cost of sales + change in w.3 (Stock Interim Delivered).
  - **Receipts check:** change in w.2 (Stock Interim Received).
  - **Days of stock:** average stock ÷ cost of sales × days.
  - **Display:** units are shown as units, never as money. An odd receipt cost is flagged.
- **Expenses:**
  - the class comes from the account map by code, then the Chart by code, then the Chart by a unique exact name (migrations 0022–0023, `restamp_expense_classes`);
  - "one-off" is judged over 12 months;
  - the full label is kept.
- **Sales:**
  - credit notes are counted apart;
  - average invoice = gross invoiced ÷ invoices;
  - refund-only customers count as active;
  - free (zero-value) lines are kept for their units.
- **Cash flow:** each line's sign follows its cash effect. The bank-charges-as-interest setting is footnoted. Retained earnings are split into prior years and this year.

## 6. Migrations (all live as of 18 Oct; nothing pending)

| File | Purpose |
|---|---|
| 0001–0004 | Core schema, functions, private helpers, invites |
| 0005 | Versions and provenance |
| 0006, 0006e | Security, revokes, pruning |
| 0007 | Account lifecycle |
| 0008 | Sales |
| 0009 | Expenses |
| 0010 | Ledger totals |
| 0011 | Stock purchases |
| 0012 | Inventory |
| 0013 | Inventory real files |
| 0014 | Import jobs (staging, pg_cron, storage) |
| 0015 | Inventory rollups |
| 0016 | Security hardening (rate scopes, Odoo key trigger) |
| 0017 | Account map |
| 0018 | Input profiles (export layouts) |
| 0019 | Import hardening (batching, timeouts, fast summaries) |
| 0020 | Odoo keys (`private.odoo_key*`, `odoo_key_norm` triggers) |
| 0021 | Save modes (`begin_sales_batch(p_all)`, `line_months`) |
| 0022 | `restamp_expense_classes` (account map by code) |
| 0023 | Expense classes from the Chart by code or unique name (`private.expense_class_for`) |

Books start needs no migration: it is stored in `companies.kpi_config.profile.booksStart`.

## 7. Live state and real figures

Not in this public copy. See the private handoff (`fathom-handoff.md`), which the owner holds.

## 8. Timeline (commit → what)

- **9–10 Oct, the build:**
  - scaffold, engine port, demo pages, Supabase/RLS/auth, Odoo importer and live connector;
  - settings, reports, PDF;
  - Odoo report reading;
  - security;
  - account lifecycle;
  - Arabic spelling and Egypt's unified chart;
  - 25-file corpus.
- **10–13 Oct:**
  - Bank readiness and Real profit (trend, stress test, memo), signed-in CI, formula review, forecast;
  - rename to iReport;
  - accuracy audit;
  - Sales sector;
  - PDF upload read by Claude;
  - guided setup with templates.
- **14 Oct:**
  - the two-box upload view;
  - the step-by-step wizard;
  - the Expenses sector;
  - ledger lines that follow the accounts;
  - messy workbooks (cash books, bank statements);
  - Arabic steps 1–3;
  - banks as lenders.
- **15–16 Oct:**
  - the modules design (`b7cda1e`) and the tie-out layer;
  - the Inventory module (valuation, moves, on hand, products, tie-outs);
  - real-file fixes (`4ae85af`);
  - background import jobs (`b4c0ab2`);
  - inventory rollups;
  - independent review fixes (`a6b50f8`).
- **17 Oct:**
  - account map (`bf6dd33`);
  - export layout memory (`f14537a`);
  - long ledgers (`d10b582`, `68dd164`);
  - continuity and the accountant's review (`9f467ef`);
  - checks by layer in Data health (`b2410e7`);
  - uploads that never stall (`975b863`);
  - multi-file merge, `.id`, dates and time zone (`dead410`);
  - four save modes, the stock gap split by reason, Odoo read-only (`2d52e0e`);
  - server-side stock reading (`cbd8b73`).
- **18 Oct, the fix plan against the 15 Oct Odoo reconciliation register (D01–D33):**
  - cut-off (`6b305ef`);
  - inventory (`4743943`, `18d151d`, `6c1d1fb`, `866ec5d`);
  - periods and Banking (`d2f6fe3`… `d2afc4e`);
  - sales and expenses (`4a4c789`, `091903b`, `89af52c`, `871d629`);
  - cash flow and retained earnings (`f3f57ef`);
  - review fixes (`5caf054`);
  - 0023 (`ef9c3bf`);
  - Banking calendar year (`fe76544`);
  - **books start** (`3f6ef17`).

## 9. Open items, in order

1. **Owner:**
   - upload Odoo's 30 Jun 2021 opening ledger on the **Opening balances** card;
   - then re-import the the main company General Ledger with cut-off **15 Oct 2026** (books start **Jul 2021**);
   - then the three stock files with **"Replace all"**;
   - reply "done".
2. **Then, read-only on the live data:**
   - the first month is Jun 2021, balance sheet only, and Jan–May 2021 are gone;
   - the opening balances equal Odoo's 30 Jun 2021 opening ledger;
   - the register's 15 Oct targets (private copy);
   - the label reads "to 15 Oct" and October counts 15 days;
   - inventory checks;
   - sales counts.
3. **To investigate:**
   - the main company's customer days for 2025 look implausibly low (money owed by customers may be misclassed);
   - the known stock gap, and the opening stock posted to w.2 (interim received) instead of the stock account.
4. **Deferred minor items** (owner to decide):
   - the stock cut-off vs the on-hand checks;
   - TB monthly columns not cut by the cut-off;
   - a cut-off later than the data;
   - refund-only "new" customers;
   - MISC series read as credit notes;
   - product days still on closing stock;
   - the retained-earnings split when data starts mid-year;
   - cash flow amortisation, disposal gains and VAT in customer days;
   - an intermittent "org_id null" server error seen once in CI (not recurring).
5. **Pending larger tasks:**
   - Arabic steps 4–5 (settings, upload wizard, reports, PDF);
   - data audit B;
   - WS7 synthetic fixtures;
   - the rest of WS3–WS6 (sign checks, partial-export warnings, accounting-rule wording, stock buckets, more live Odoo pulls);
   - modules: Payments, Rental, Purchasing (design in the spec);
   - R3 (bank readiness simplified for Egypt), R4, R5, R7 (business lines), R13 (visuals).

## 10. How to work (the process that has worked)

1. **Check before claiming:** read-only SQL on the live project, or run the code. Never state a figure without its source.
2. **Tests first:**
   - write the failing test on made-up data;
   - watch it fail;
   - fix;
   - watch it pass.
3. **Real-data check:** the private fixture test with `RECON_DIR`. Every line within 1 EGP, or the cause named by document.
4. **Before each push:**
   - typecheck, lint, unit and DB tests;
   - both browser suites: they serve the last production build, so first run `set -a && . .local-supabase/env && set +a && npx next build`, and reset the rate counter;
   - then push and check CI.
5. **Schema change:** write the migration, give the owner the path and the text, wait for "done", then verify read-only.
6. **Reply to the owner briefly:**
   - what changed;
   - verified figures;
   - what they need to do, as numbered steps.

## 11. Starting a new chat

Paste this (and attach the private handoff file):

> Continue the iReport project (repo mohamedomar-create/fathom, branch claude/sharp-pasteur-ms9hn6). Read docs/HANDOFF.md and the attached fathom-handoff.md first; follow the standing rules in section 2. The next step is section 9, item 1.
