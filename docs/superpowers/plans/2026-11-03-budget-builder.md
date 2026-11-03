# Budget Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the inside of the Budget page so a budget is built from the company's own sales, customer and expense
figures, through a per-company setup (standalone products, owner groups, sales/rental streams, merged expenses).

**Architecture:** A pure engine (`budget-builder.ts`) turns sales/expense summaries + a setup into base columns and
budget rows; rows are stored per version (`budget_rows`, migration 0053) and, on every save, converted to the existing
`budget_lines` in the same transaction so Financials, Budget vs actual, KPI targets, reports and export keep working
unchanged. The page gets a setup wizard and one shared sheet component used by every tab.

**Tech Stack:** Next.js 16, Supabase (RLS + security-definer RPCs), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-budget-builder-design.md`

## Global Constraints
- Writes only through security-definer functions with `search_path=''`, editor check, draft-only (reuse
  `private.budget_draft`); anon revoked; `private.install_tenant_guards()` at the end; `schema_version()` returns 53;
  `REQUIRED_SCHEMA` 53. Migration is pasted by the owner.
- ≤ 20,000 rows per save; all or nothing.
- Amounts in the app's natural sign (income and costs positive); months `YYYY-MM`; 2-decimal rounding, remainder in the
  last month so a row's months sum exactly to its year.
- Every label in `src/lib/i18n/areas/bud.ts` in EN and AR.
- No real company data in git; guard scan CLEAN before every push. Tests first, watched failing.
- Ruling (spec deviation): the company setup is stored in a new table `budget_setups(company_id pk, setup jsonb,
  updated_at, updated_by)` with a definer setter, not as a `kpi_config` merge key. Same editor-only rule; avoids
  rewriting `update_company_settings`. Cost if wrong: one extra table.

## Review Focus
- A company with sales lines but no product names (all lines on "No product"): setup still works; everything lands in
  Others; no crash. → Task 2 test `others-only`.
- A product both ticked standalone and inside a group: counted once (standalone wins); group view does not double it.
  → Task 2 test `standalone-wins`.
- A row whose last-year months are all zero but has a year amount: spreads by the company revenue pattern, else equally;
  months sum exactly. → Task 2 test `spread-fallbacks`.
- Customer view after the owner edits customers so they exceed revenue: difference shown as negative, Balance never
  makes an unedited customer negative (floor 0, leftover stays as difference). → Task 3 test `balance-floor`.
- Setup changed after a version was built: stored version rows and lines unchanged; the page warns "setup changed since
  this version" instead of silently regrouping. → Task 5 test `setup-drift`.

---

### Task 1: Migration 0053 (setup table, version setup copy, budget_rows, save functions)

**Files:**
- Create: `supabase/migrations/0053_budget_builder.sql`
- Create: `supabase/tests/budget_builder.sql` (registered like `budgets.sql` in `scripts/test-db.sh`)
- Modify: `src/lib/schema.ts` (`REQUIRED_SCHEMA = 53`), `src/lib/supabase/database.types.ts` (new tables/RPCs)

**Interfaces:**
- Produces:
  - `public.budget_setups(company_id uuid pk → companies cascade, setup jsonb not null, updated_at, updated_by)`, RLS read
    for members; `public.budget_setup_save(p_company uuid, p_setup jsonb) returns void` (editor; `setup` must be an
    object ≤ 1 MB).
  - `budget_versions.setup jsonb` (nullable).
  - `public.budget_rows(version_id → budget_versions cascade, company_id, view text check in
    ('revenue','customer','expense'), key text 1..220, label text, mode text check in ('year','months'), basis jsonb,
    cost jsonb, months numeric[] check cardinality 12, updated_at, primary key (version_id, view, key))`, RLS read.
  - `public.budget_rows_save(p_version uuid, p_rows jsonb, p_views text[], p_lines jsonb, p_setup jsonb) returns void`:
    in one transaction, `private.budget_draft`; for each view in `p_views` delete that view's rows then insert the
    given rows (≤ 20,000, each key once per view, months 12 finite numbers |x| < 1e15); replace all `budget_lines` of
    the version with `p_lines` (same validation as `budget_save_lines` with replace); when `p_setup` is not null set
    `budget_versions.setup`.
  - `budget_create` copies `setup` and `budget_rows` when `p_from` is given.
  - Rate scope reuse: `budget` (no new scope).

- [ ] **Step 1: Write the failing DB test `supabase/tests/budget_builder.sql`** covering: viewer and outsider refused on
  `budget_setup_save` and `budget_rows_save`; editor saves setup, re-save replaces it; rows saved for view revenue leave
  customer rows untouched; `p_lines` replaces lines; approved version refuses rows and setup; a row with 11 months
  refused; duplicate key in one view refused; 20,001 rows refused; 20,000 rows saved under 8 s; `budget_create` with
  `p_from` copies rows and setup; no direct insert/update/delete on `budget_rows` / `budget_setups` for authenticated;
  `schema_version()` = 53.
- [ ] **Step 2: Run it** — `/tmp/claude-0/-home-user-fathom/caf486be-4e84-5122-a10e-05d8634f679e/scratchpad/one-db.sh supabase/tests/budget_builder.sql` — Expected: FAIL (function does not exist).
- [ ] **Step 3: Write `0053_budget_builder.sql`** with the objects above (pattern of 0052: `jsonb_array_elements WITH
  ORDINALITY` + `jsonb_to_record`, revoke from anon/public, grant execute to authenticated, tenant guards, schema 53);
  apply locally, `notify pgrst, 'reload schema'`.
- [ ] **Step 4: Run the test and the full DB suite** — `DB_URL=postgres://postgres@127.0.0.1:54322/postgres TEST_DB=bu_full sh scripts/test-db.sh` — Expected: all pass.
- [ ] **Step 5: Commit** "Budget builder storage (0053): company setup, rows per version, one save for rows and lines".

### Task 2: Engine — base columns, items from setup, spread

**Files:**
- Create: `src/lib/engine/budget-builder.ts`
- Test: `tests/unit/budget-builder.test.ts`

**Interfaces:**
- Consumes: `SalesProductRow`, `SalesCustomerRow` (`engine/sales.ts`), `ExpenseAccountRow` (`engine/expenses.ts`),
  `fyMonths(fy, fyStart)` (`engine/budget.ts`).
- Produces:
  ```ts
  export interface BudgetSetup {
    products: string[];
    groups: { id: string; name: string; products: string[]; customers: string[] }[];
    streams: { rental: string[] };          // product keys and "acct:<key>" revenue accounts
    expenses: { merged: { id: string; name: string; accounts: string[] }[]; excluded: string[] };
  }
  export interface BaseCol { key: string; label: string; years: { fy: string; amount: number }[]; ytd: number; estimate: number; months: number[] /* this year estimate by month, 12 */; lastYear: number[] /* 12 */; units?: number; price?: number; unitCost?: number | null }
  export function baseYears(series: Map<string, Map<string, number>>, fy: string, fyStart: number, asOf: string, yearsBack?: number /* default 3 */): Omit<BaseCol, "key"|"label"> // series: key → month → amount
  export function productSeries(rows: SalesProductRow[]): Map<string, Map<string, number>>
  export function customerSeries(rows: SalesCustomerRow[]): Map<string, Map<string, number>>
  export function expenseSeries(rows: ExpenseAccountRow[], setup: BudgetSetup): Map<string, Map<string, number>> // merged groups summed under "expgrp:<id>", excluded dropped, others "exp:<t>"
  export function itemOf(product: string, setup: BudgetSetup): string   // "prod:<p>" | "grp:<id>" | "others"
  export function revenueItems(rows: SalesProductRow[], setup: BudgetSetup): Map<string, Map<string, number>>
  export function spread(year: number, pattern: number[], fallback?: number[]): number[]
  ```
  `fy` is the budget year; base years are the `yearsBack` financial years before it; "this year" = fy − 1 (to date at
  `asOf`, estimate = actual months + remaining months at last year's same month × (this year to date ÷ last year same
  months to date), or last year's month when that ratio cannot be formed).

- [ ] **Step 1: Write failing tests**: `base-years` (made-up 3 years of monthly sales: years, ytd, estimate exact);
  `estimate-ratio` (this year running 10% above → remaining months = last year × 1.1); `top-n-and-others`;
  `group-membership`; `standalone-wins` (product in a group and standalone counted once under prod:);
  `others-only` (all products "No product" → only "others"); `expenses-merged-excluded`;
  `spread-exact` (sum equals year to the cent, by pattern); `spread-fallbacks` (zero pattern → fallback → equal).
- [ ] **Step 2: Run** `npx vitest run tests/unit/budget-builder.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement the functions above in `budget-builder.ts`.**
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** "Budget builder engine: base years, this year's estimate, items from setup, seasonal spread".

### Task 3: Engine — rows, views, cost, P&L lines, actuals

**Files:**
- Modify: `src/lib/engine/budget-builder.ts`
- Test: `tests/unit/budget-builder.test.ts`

**Interfaces:**
- Consumes: Task 2 types/functions; `BudgetLine` (`engine/budget.ts`).
- Produces:
  ```ts
  export type Basis = { kind: "amount"; value: number } | { kind: "pct"; value: number } | { kind: "units"; units: number; price: number };
  export type Cost = { kind: "unit"; value: number } | { kind: "margin"; pct: number } | null;
  export interface BudgetRow { view: "revenue" | "customer" | "expense"; key: string; label: string; mode: "year" | "months"; basis: Basis | null; cost: Cost; months: number[] }
  export function rowMonths(basis: Basis, base: BaseCol): number[]           // amount → spread(lastYear); pct → estimate×(1+pct/100) spread; units → units×price spread
  export function costMonths(row: BudgetRow, base: BaseCol): number[]        // unit: months/price×unit cost (units basis) ; margin: months×(1−pct/100); null: last year's margin from base (unitCost or k/ka), else 0
  export function customerView(revenueMonths: number[], customers: BaseCol[], edited: BudgetRow[]): { rows: BudgetRow[]; difference: number[] }
  export function balanceCustomers(view: ReturnType<typeof customerView>, editedKeys: Set<string>): BudgetRow[] // spreads difference over unedited by share, floor 0
  export function streamView(revenue: BudgetRow[], setup: BudgetSetup, members: Map<string, string[]>): { sales: number[]; rental: number[] }
  export function groupView(revenue: BudgetRow[], customers: BudgetRow[], setup: BudgetSetup): { id: string; name: string; months: number[] }[]
  export function budgetToLines(rows: BudgetRow[], bases: Map<string, BaseCol>, months: string[]): BudgetLine[] // revenue → key "cls:revenue", cost → "cls:cos_variable", expense rows → their account key ("#code"/"@name" from ExpenseAccountRow.t) with class from the row; one line per key and month
  export function actualByItem(rows: SalesProductRow[], setup: BudgetSetup, months: string[]): Map<string, number[]>
  ```
  A stream view for a group mixing sales and rental products splits by each member's share of this year's estimate
  (`members`: item key → product keys).

- [ ] **Step 1: Write failing tests**: `amount-basis`, `pct-basis`, `units-basis`; `months-mode` (typed months kept);
  `cost-unit`, `cost-margin`, `cost-default-last-year`; `customer-shares` (sum = revenue, difference 0);
  `customer-edit-difference`; `balance-floor` (over-budgeted edits: unedited go to 0, leftover remains as difference);
  `stream-split` (group with one rental product splits by share); `group-view-sum` (product groups + "Others" =
  revenue); `lines-total` (budgetToLines revenue/cost/expense totals equal row totals per month);
  `actual-by-item` (actuals grouped like setup).
- [ ] **Step 2: Run** `npx vitest run tests/unit/budget-builder.test.ts` — Expected: FAIL on the new tests.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS; also `npx vitest run tests/unit/budget.test.ts` still PASS.
- [ ] **Step 5: Commit** "Budget builder engine: rows, customer/stream/group views, cost of sales, P&L lines, actuals".

### Task 4: Setup suggestions

**Files:**
- Create: `src/lib/engine/budget-setup.ts`
- Test: `tests/unit/budget-setup.test.ts`

**Interfaces:**
- Consumes: `BudgetSetup`, `productSeries`, `revenueItems` (Task 2).
- Produces:
  ```ts
  export interface RentalHint { key: string; reason: "name" | "location" | "analytic" | "account" }
  export function suggestSetup(products: SalesProductRow[], opts: { top?: number /* 15 */; rentalProducts?: string[]; rentalAccounts?: string[] }): { setup: BudgetSetup; hints: RentalHint[]; coverage: number /* share of estimate in standalone */ }
  export function emptySetup(): BudgetSetup
  export function setupDrift(versionSetup: BudgetSetup | null, current: BudgetSetup): boolean
  ```
  Rental name rule: `/\b(rent|rental|lease|hire)\b|إيجار|ايجار|تأجير/i` on product name. Groups suggested one per
  category (`SalesProductRow.g`), id = slug of the name, products = members; customers [].

- [ ] **Step 1: Write failing tests**: `top-15-by-estimate`, `coverage`, `rental-by-name` (EN + AR),
  `rental-by-location-and-account` (opts lists), `category-groups`, `setup-drift`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/budget-setup.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement.** Rental location products come from the inventory rollup (caller passes them).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** "Budget setup suggestions: top products, category groups, rental hints".

### Task 5: Load and save (server)

**Files:**
- Modify: `src/lib/company/budget-load.ts`, `src/app/company/[id]/analysis/budget-actions.ts`
- Modify: `src/app/company/[id]/analysis/budget/page.tsx` (load setup, rows, sales, expenses, rental hints)
- Test: `tests/unit/budget-actions.test.ts` (zod schemas exported from a plain module `src/lib/company/budget-schema.ts`)

**Interfaces:**
- Consumes: Task 1 RPCs; Task 2–4 types.
- Produces:
  - `loadBudgetSetup(supabase, companyId): Promise<BudgetSetup | null>`; `loadBudgetRows(supabase, versionId)` extended
    to also return `rows: BudgetRow[]` and `setup: BudgetSetup | null` (paged 1,000 at a time).
  - Server actions: `saveBudgetSetup(companyId, setup)`; `saveBudgetRows(companyId, versionId, { rows, views, lines,
    setup })` — zod-checked (`RowSchema`, `SetupSchema` in `budget-schema.ts`), rate scope `budget`, calls
    `budget_rows_save`, revalidates the company layout.
  - The server re-derives nothing: `lines` come from `budgetToLines` on the client, checked by zod for shape and that
    each month's revenue line equals the sum of revenue rows' months (±0.01), else refused.

- [ ] **Step 1: Write failing tests**: schema accepts a valid setup and rows; refuses months ≠ 12, a basis kind outside
  the three, > 20,000 rows, lines whose revenue ≠ rows (`lines-match-rows`); `setup-drift` surfaces through
  `setupDrift`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/budget-actions.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** schemas, loaders, actions, page data.
- [ ] **Step 4: Run** — Expected: PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** "Budget builder: load and save setup and rows".

### Task 6: Setup wizard

**Files:**
- Create: `src/components/analysis/budget-setup-wizard.tsx`
- Modify: `src/lib/i18n/areas/bud.ts`
- Test: `tests/e2e-auth/budget-builder.spec.ts` (first half)

**Interfaces:**
- Consumes: `suggestSetup`, `saveBudgetSetup`.
- Produces: `<BudgetSetupWizard companyId products customers expenses hints initial onDone(setup) />` with testids
  `bsetup-step-{1,2,3}`, `bsetup-product-<i>`, `bsetup-coverage`, `bsetup-group-new`, `bsetup-group-name`,
  `bsetup-member-<i>`, `bsetup-rental-<i>`, `bsetup-exp-merge`, `bsetup-save`.

- [ ] **Step 1: Write the failing signed-in test** "setup: top products ticked, a group created with a product and a
  customer, a rental product confirmed, two expenses merged; saved and reloaded the same" (asserts through
  `public.budget_setups.setup` via psql, like `tests/e2e-auth/budget.spec.ts`).
- [ ] **Step 2: Run** `E2E_AUTH=1 npx playwright test tests/e2e-auth/budget-builder.spec.ts --project=desktop` — Expected: FAIL.
- [ ] **Step 3: Implement** the 3 steps (search + filter lists, tick boxes, group editor, rental hints with reasons,
  expense merge/exclude); every label EN + AR.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** "Budget setup wizard: products, owner groups, rental, expenses".

### Task 7: Budget sheet and tabs

**Files:**
- Create: `src/components/analysis/budget-sheet.tsx`
- Modify: `src/components/analysis/budget-page.tsx` (tabs Revenue, Customers, Sales vs rental, By group, Expenses,
  Budget vs actual; New budget dialog gains "From the setup"), `src/lib/i18n/areas/bud.ts`
- Test: `tests/unit/budget-input.test.ts`, `tests/e2e-auth/budget-builder.spec.ts` (second half)

**Interfaces:**
- Consumes: Task 3 functions, Task 5 actions.
- Produces:
  - `parseBudgetInput(text: string): Basis | null` (`"120000"`, `"120,000"`, Arabic digits → amount; `"+10%"`, `"-5 %"`
    → pct; empty → null) in `src/lib/engine/budget-builder.ts`.
  - `<BudgetSheet rows bases editable onChange />` with testids `bsheet-row-<key>`, `bsheet-input-<key>`,
    `bsheet-open-<key>`, `bsheet-month-<key>-<i>`, `bsheet-auto-<key>`, `bsheet-units-<key>`, `bsheet-price-<key>`,
    `bsheet-total`, `bsheet-strip`, `bsheet-select-<key>`, `bsheet-apply-pct`, `customer-diff`, `customer-balance`.

- [ ] **Step 1: Write failing tests**: unit `parse-input` cases above; signed-in "a version from the setup: revenue row
  +10% equals estimate × 1.1, a month edit keeps the year as months sum, units × price on a product, a customer edit
  shows the difference and Balance clears it, approve locks every input; Financials Budget comparison reads the saved
  lines".
- [ ] **Step 2: Run** unit and signed-in commands — Expected: FAIL.
- [ ] **Step 3: Implement** the sheet (columns: prior years, this year to date, estimate, change %, new year; ▸ months;
  sticky total; strip revenue / gross profit / net profit; multi-select apply %; Others expandable; phone: name,
  estimate, new year, tap opens months in a bottom sheet) and wire the tabs; save sends rows + `budgetToLines` +
  version setup.
- [ ] **Step 4: Run** — Expected: PASS; existing `tests/e2e-auth/budget.spec.ts` still PASS.
- [ ] **Step 5: Commit** "Budget sheet: build from prior years, views of one revenue, months on demand".

### Task 8: Demo, accessibility, full verification

**Files:**
- Modify: `src/lib/company/demo-budget.ts`, `src/components/analysis/demo-budget.tsx`, `tests/e2e/budget.spec.ts`

- [ ] **Step 1: Write failing public test**: demo budget shows setup groups Hospitals and Homecare, a rental stream, a
  Customers tab with a 0 difference; axe 0 violations in EN and AR.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/budget.spec.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** demo data (made-up names) through `suggestSetup` + rows.
- [ ] **Step 4: Run all suites**: unit, DB, build, public and signed-in browser, lint; private check that base columns
  equal Sales and Expenses per year for TotalCare (scratchpad, `RECON_DIR`); guard scan CLEAN — Expected: all green.
- [ ] **Step 5: Commit, push `claude/phase5f`, check CI.**
