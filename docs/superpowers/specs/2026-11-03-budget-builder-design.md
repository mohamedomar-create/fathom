# Budget builder: built from the company's own figures, set up per business

Status: design, for the owner's review. Replaces the inside of the Budget page (Financials ▸ Plan ▸ Budget) released
on 3 Nov (b20fa9c, migration 0052). Versions, approval, template, Budget vs actual, the Financials comparison, KPI
targets and reports stay.

## Why
The first budget page starts from a blank grid or "last year + %" on every account. Owners want to build next year the
way they think about the business: their main products, their own groups (e.g. Hospitals, Homecare), sales vs rental,
every customer and every expense, each beside the previous years' figures. The setup must fit any business: every
company chooses its own products, groups and streams. Nothing is fixed in code.

## Owner's decisions (3 Nov)
- Revenue is planned **once**; Customers, Sales vs rental and By group are **views of the same revenue**. They always
  total the same, and any difference is shown until the owner balances it.
- Groups are the **owner's own**, per company: any names, any products and customers ticked into them, suggested from
  existing product categories.
- Entry per row: **yearly by default** (amount, % change, or units × price) with months spread automatically; **any row
  can switch to a 12-month grid**.
- Sales vs rental: **the system suggests, the owner confirms**, per product or revenue account; saved per company.
- Base: **2–3 prior full years + this year to date + this year's estimate** (actual to date + last year's pattern for
  the remaining months). The new year starts from the estimate.

## 1. Company budget setup (per company, reusable across versions)
Stored as `kpi_config.budgetSetup` through `update_company_settings` (merge key added in 0053; editors only). Shape:
- `products`: product keys that stand alone (default: the 15 largest by this year's estimate). Everything else goes
  to **Others**.
- `groups`: `[{ id, name, products: string[], customers: string[] }]`. The owner creates any number, with any names.
  Suggestions come from product categories (one group per category, owner keeps, renames or drops them).
- `streams`: `{ rental: string[] }`: product keys and revenue account keys marked rental; the rest are sales.
  Suggested (with a reason shown) from names containing rent/rental/lease/إيجار, the rental stock location, and an Odoo
  analytic plan named rent; owner ticks or unticks.
- `expenses`: `{ merged: [{ id, name, accounts: string[] }], excluded: string[] }`.
- Changing the setup never changes figures stored in a version; a version keeps a copy of the setup it was built with
  (`budget_versions.setup jsonb`).

## 2. Storage (migration 0053, pasted by the owner)
- `budget_versions.setup jsonb` (copy of the setup at creation; editable while draft).
- `budget_rows(version_id, company_id, view 'revenue'|'customer'|'expense', key, label, mode 'year'|'months',
  basis jsonb, cost jsonb, months numeric[12], primary key (version_id, view, key))`
  - `basis`: how the figure was entered, one of `{kind:'amount',value}`, `{kind:'pct',value}` (on this year's
    estimate), `{kind:'units',units,price}`. Kept only to show and re-edit; `months` are what count.
  - `cost` (revenue rows): `{kind:'unit',value}` or `{kind:'margin',pct}`; null means last year's margin.
  - Keys: `prod:<product>`, `grp:<group id>`, `others`, `cust:<customer>`, `exp:<account key>`, `expgrp:<id>`.
- Writes only through security-definer functions (`search_path=''`, editor check, draft-only lock as
  `private.budget_draft`): `budget_rows_save(version, rows jsonb, replace_view text null)` (≤ 20,000 rows, all or
  nothing), `budget_setup_set(version, setup jsonb)`. Read: RLS for members. Tenant guards; schema_version 53.
- Versions made before 0053 keep their `budget_lines`/`budget_products` and are read as before. A new version made as
  a copy of one keeps its lines as fixed rows until the owner rebuilds it from the setup.

## 3. Engine (`src/lib/engine/budget-builder.ts`, pure, tested)
- `baseYears(sales, expenses, fyStart, asOf)`: per key, the figures for up to 3 prior full financial years, this year to
  date, and this year's estimate = actual months + for each remaining month last year's same month × (this year to
  date ÷ last year same months), falling back to the last year's month when last year had no part to compare.
- `itemsFromSetup(setup, salesProducts)`: maps every product to its revenue item (standalone product, its group, or
  Others; a product in a group and also standalone stays standalone) and to sales or rental.
- `spread(yearAmount, pattern)`: months by the row's own last-year pattern; with no history, the company's revenue
  pattern; with no pattern at all, equal months. Rounded to 2 decimals, remainder in the last month so the sum is exact.
- `rowMonths(row, base)`: amount → spread; pct → estimate × (1 + pct) spread; units → units × price spread by the
  unit pattern; `mode:'months'` → months as typed.
- `customerView(revenueTotal, customers, edits)`: each customer's share of this year's estimate × budgeted revenue;
  edited customers keep their figures; returns rows plus `difference` per month (never hidden).
- `streamView` and `groupView`: re-cut the revenue rows by sales/rental and by group.
- `budgetCost(row, base)`: units × unit cost, or revenue × last year's (or set) margin.
- `budgetToLines(version)`: revenue rows → `cls:revenue`, cost → `cls:cos_variable`, expense rows → their accounts, so
  `budgetAccounts`, `budgetComparison`, `varianceRows`, KPI targets, reports and export keep working unchanged.
- Budget vs actual: actual sales are grouped through the same `itemsFromSetup`, so each row has its actual.

## 4. Screens
- **Setup wizard** (first visit; reopen from "Setup"): 1 Products (all products by estimate, top 15 ticked, running
  "these N = X% of revenue"); 2 Groups and streams (create, rename or delete groups; tick products and customers with
  search and filter; rental suggestions with reasons); 3 Expenses (merge or exclude accounts).
- **Budget sheet** (shared component for every tab): columns for the prior years, this year to date, this year's
  estimate, change % and the new year (editable). Cell input: `120000` (amount), `+10%` (pct), or units × price boxes on
  product rows. ▸ opens the 12 months (switches the row to months; "Back to auto" resets). Sticky totals, a top strip
  (revenue, gross profit, net profit updating as typed), multi-select + "apply x%" / "copy this year". Others opens to
  show its members.
- **Tabs**: Revenue (items), Customers, Sales vs rental, By group, Expenses, Budget vs actual. A banner on Customers
  when it differs from revenue, with "Balance" (spreads the difference over unedited customers).
- **Phone**: name, estimate and new year columns; tap opens a bottom sheet with the months.
- **Demo**: `/demo/analysis/budget` with made-up groups (Hospitals, Homecare), a rental stream and customers.
- Arabic for every label; right-to-left layout.

## 5. Out of scope here
Business plan (next), headcount planning, capex planning, cash-flow budget beyond what the P&L budget implies.

## 6. Testing
- Unit (written first, seen failing): base years and the estimate; top-N and Others; group assignment and precedence;
  rental suggestions; spread sums exactly; pct, units and months rows; customer shares, edits and difference; stream and
  group views add up to revenue; cost by unit cost and margin; `budgetToLines` totals equal the sheet totals; Budget vs
  actual grouping.
- Database (`supabase/tests/budget_builder.sql`): viewer and outsider refused; approved version locked for rows and
  setup; replace by view is atomic; 20,000 rows within 8 s; setup merge key editor-only.
- Signed-in browser: setup wizard → create a group and mark a rental product → yearly, %, months and units edits →
  customer edit shows the difference and Balance clears it → approve → locked. Public browser: the demo page, axe in
  English and Arabic.
- Private: TotalCare's real data, base columns equal Sales and Expenses per year to the pound.
- Independent review before release; CI; the owner pastes 0053 and approves.
