# Website Blueprint — Product "X" (name withheld)

> **Purpose of this file.** A full, brand-neutral spec of one live web app, written so that (a) Claude Code can rebuild it, and (b) a guessing tool can work out its name, its type and how it works without being told.
> **Rules used when writing it:** the product name, logo, parent company, support domain and help-centre URLs have been removed. All numbers in the examples are **synthetic** (made up, but they follow the app's own formulas). Labels, menus, options and formulas are copied **exactly** as they appear in the app.
> **Source:** hands-on walk-through of a logged-in account (1 organisation, 1 company, data imported from Excel, local currency, financial year Jan–Dec). Date of capture: Oct 2026.

---

## 0. Quick fingerprint (read this first)

- **What it is:** a web-based (SaaS) **financial analysis, management reporting and 3-way forecasting** platform for small and mid-sized businesses. It is mainly sold to **accountants, bookkeepers and advisory firms**, who look after many client companies from one portfolio.
- **Core loop:** connect the accounting system (or upload Excel) → the app maps the chart of accounts into standard classes → it calculates KPIs, breakeven, cash flow, growth and trend → users build branded PDF/online management reports → users build a rolling 3-way forecast (P&L + Balance Sheet + Cash Flow).
- **Three pillars on the home screen:** `Analysis` · `Reporting` · `Forecasting`.
- **Integrations offered:** QuickBooks, Xero, FreeAgent, MYOB, Sage, Google Sheets, Excel.
- **Language:** UK English throughout ("Organisation", "centre", "colour", "Amortisation", "customise").
- **Legal footer:** a company with the "**Pty Ltd**" suffix (an Australian private company), plus a support email on the product's own domain.
- **Pricing seen:** per-company plans ("Starter base plan" → "Pro"), plus a separate "Portfolio" plan. Billed in **USD/month** (example: 1 company, Pro = $59.00/month).
- **AI:** "Commentary Writer (Beta)" inside the report editor, and an "AI business context" section in the company profile.

---

## 1. Product classification

| Dimension | Value |
|---|---|
| Category | B2B SaaS · FP&A (financial planning & analysis) · management reporting · cash-flow forecasting |
| Primary users | Accounting / advisory firms (multi-client), CFOs, finance managers, business owners |
| Tenancy | Organisation (the firm) → many Companies (clients) → optional Groups (Consolidated / Benchmark) |
| Data source | Accounting-system integration or spreadsheet import. No transactions are entered in the app (read-only analysis on top of the general ledger) |
| Time grain | Monthly periods; views by Month / Quarter / Year; YTD and rolling 12 months |
| Outputs | On-screen analysis, PDF and online reports, Excel exports, a 3-way forecast, a portfolio dashboard |
| Monetisation | Subscription per company, with plan tiers (Starter / Pro) and a Portfolio plan |

---

## 2. Platform & technical observations

- Single-page app (client-side routing). Short random company IDs in the URL (`/company/{7-char id}/…`).
- Period state lives in the query string (`?rangeId=…`, `&comparison=priorPeriod`, `&type=balanceSheet|cashFlow`, `&layout=normal`).
- Segment-style analytics snippet in the page. A chat/support widget (bottom right) with an unread badge.
- `Cookie Settings` in the user menu (consent manager).
- Keyboard shortcuts: `?` = shortcut list, `F1` = help centre.
- Top-bar sync status dropdown ("No updates") shows the import/integration queue. A bell icon holds notifications ("You're all up to date with your notifications, nice!").
- PDF engine with paper-size setting (A4 by default) and a footer template using tokens.
- Two-factor authentication can be enforced per organisation.
- Charts: SVG line / area / bar / scatter / donut / waterfall charts with hover tooltips.

---

## 3. Sitemap & routes

```
/companies                              Portfolio home (company cards)
/dashboard                              Insights Dashboard (multi-company table)
/thresholds                             Threshold Manager (Thresholds | Companies tabs)

/company/{id}/analysis/kpi-numbers      KPIs table
/company/{id}/analysis/kpi-explorer     KPI Explorer (radial chart)
/company/{id}/analysis/profitability    Profitability / Breakeven
/company/{id}/analysis/cashflow         Cash Flow waterfall
/company/{id}/analysis/growth           Growth quadrant
/company/{id}/analysis/trend            Trend charts
/company/{id}/analysis/goalseek         Goalseek (sensitivity)
/company/{id}/analysis/financials       Financial statements (P&L | Balance Sheet | Cash Flow Statement)

/company/{id}/reporting                 Draft reports
/company/{id}/reporting/published       Published reports
/company/{id}/reporting/schedules       Report schedules
/company/{id}/reporting/excel-reports   Excel exports
/company/{id}/reporting/report/{rid}/edit  Report editor

/company/{id}/forecasting               Forecast grid (P&L)
/company/{id}/forecasting/balance-sheet
/company/{id}/forecasting/cash-flow
/company/{id}/forecasting/drivers
/company/{id}/forecasting/roadmap       Business Roadmap (microforecasts timeline)
/company/{id}/forecasting/settings      General | Accounts | Tax

/company/{id}/settings/source-data                 1 Source Data › Financials
/company/{id}/settings/source-data/budgets         1 › Budgets
/company/{id}/settings/source-data/non-financials  1 › Non-financials
/company/{id}/settings/profile                     2 Company Profile
/company/{id}/settings/chart-of-accounts           3 Chart of Accounts
/company/{id}/settings/select-kpis                 4 KPIs
/company/{id}/settings/set-targets                 5 Targets
/company/{id}/settings/set-alerts                  6 Alerts

/administration/profile | terminology | tags | account | people | reporting | security | beta-features | kpi-library | delete
/person/change-my-details
/logout
```

---

## 4. App shell (global layout)

### 4.1 Top bar (dark charcoal, full width, ~44px high)
Left to right:
1. `←` back arrow (goes to portfolio)
2. **Company switcher**: company name + chevron (dropdown of companies)
3. Module tabs: `Analysis` · `Reports` · `Forecast` · `Settings` (active tab has a slightly lighter pill background)
4. (right side) Sync status: refresh icon + "No updates" + chevron
5. Bell (notifications)
6. `?` Help menu → `Keyboard Shortcuts`, `Help Centre`
7. Gear menu → `Organisation Settings`, `User Management`, `Account / Billing`, `KPI Library`, `Delete a Company or Group`
8. Avatar menu → `My Details`, `Cookie Settings`, `Logout`

At portfolio level the company switcher and tabs are hidden. Admin pages show "← My companies".

### 4.2 Left icon rail (~66px, white, icon-only, tooltips on hover, active item = pale green square)
- **Portfolio:** Companies (briefcase), Insights Dashboard (line chart), Thresholds (document + clock). At the bottom: two utility icons (thresholds/sync).
- **Analysis:** KPIs (clipboard tick) · KPI Explorer (✕/% glyph) · Profitability (axes chart) · Cash Flow (fan/wheel) · Growth (plant pot) · Trend (zig-zag) · Goalseek (telescope) · Financials (document). At the bottom: **Download** (cloud with arrow → Analysis PDF).
- **Reports:** Search · Drafts · Published · Schedules · Excel reports. At the bottom: **Education**.
- **Forecast:** Forecast (telescope) · Roadmap · Microforecasts · Scenarios. At the bottom: Education · Settings · Download.
- **Report editor:** Outline · Text · Charts · Tables & Financials · Files & Media · Layouts. At the bottom: Commentary Writer (AI) · Settings · Publish · Download.

### 4.3 Page header pattern (every analysis page)
- Light grey band. Large title on the left (~32px, regular weight).
- **Sentence-style period picker** on the right: `For the [Month ▾] of [Aug 2026 ▾]`. Growth/Trend use `Up to the [Month] of [Aug 2026]`. The picker words have a **dashed underline** and open popovers.
  - Period type options: `Month` · `Quarter` · `Year`.
  - Date popover: left column "Select a year" (2022…2026), right grid "Select a month" (Jan–Dec, 3×4). Future months are greyed out. The selected month is in a pale green chip.
- A second line holds the page's own **sentence controls**, e.g. `Showing [25 KPIs] comparing with [Target]`.

---

## 5. Design system

| Token | Value / look |
|---|---|
| Top bar | near-black charcoal `#2B2B2B`–`#333`, white text |
| Page bg | white. Header band light grey `#F5F5F4` |
| Primary (buttons, active, positive) | muted sage green `~#6BA368` / `#7CB46B`. Primary button = filled green, white text, 4px radius |
| Secondary button | white with green 1px border and green text |
| Negative | red `~#D9343A` (lines, ✕ icons, negative text). Negative KPI tile = pale red background `#FCE4E4` with red text |
| Positive | green ✓ icon, green ▲ triangle |
| Neutral text | `#222` headings, `#777` labels. Labels are UPPERCASE, small (11–12px), letter-spaced |
| Category badge | small square letter badge (A, B, C…) coloured per KPI category: blue (Profitability), purple (Activity), etc. |
| Importance chips | `Critical` (red), `High` (orange), `Medium` (blue), `Low` (grey). Shown as pill dropdowns in settings, plain text in the KPI table |
| Typography | geometric/humanist sans (similar to "Gilroy"/"Poppins"). Big numbers 28–32px, regular weight |
| Numbers | currency symbol before the number, thousands separators, no decimals for money, 2 decimals for %; negatives shown as `-¤ 140,270` (minus before the symbol) |
| Dashed-underline links | used for every inline selector and "Top ten … accounts" drill-downs |
| Cards | white, very light shadow, 4–6px radius, generous padding |
| Tables | thin grey row lines, bold total rows with a heavier top border, right-aligned numbers |
| Empty states | line-art illustration + title + one sentence + green CTA button |
| Charts | thin lines (2px) with round dots on each point; pale grid; area fill at ~15% opacity; legend as coloured pill labels placed on the chart |

---

## 6. Data model (entities)

```
Organisation(id, name, logo, country, state, timezone, address, phone, website, brandColour,
             termsOfUse, defaultTerminology, plan)
User(id, name, email, role ∈ {ADMIN, EDITOR, …}, lastLogin, security(2FA))
Tag(id, name, categoryId) ; TagCategory
Company(id, orgId, name, logo, source ∈ {QuickBooks, Xero, FreeAgent, MYOB, Sage, Google Sheets, Excel},
        lastUpdated, fyStartMonth, fyEndMonth, terminology, currency, size,
        aiContext{goals, strategy, marketConditions, currentPosition, other},
        defaultRates{taxRate, interestRate, wacc}, industry{division, subdivision, group, class})
Group(id, type ∈ {Consolidated, Benchmark}, companyIds[≥2])
Period(companyId, yyyymm) ; DateRange(start, end)
Account(id, companyId, code, name, statement ∈ {PL, BS}, class, behaviour ∈ {FIXED, VARIABLE, DEPRECIATION}, heading, order)
  PL classes: Revenue, Cost of Sales, Expenses, Other Income, Other Expenses, Interest Income,
              Interest Expenses, Tax Expenses, Adjustments, Dividends
  BS classes: Cash & Equivalents, Accounts Receivable, Inventory, Work In Progress, Other Current Assets,
              Fixed Assets, Intangible Assets, Investments/Other Non-Current Assets,
              Short Term Debt, Accounts Payable, Tax Liability, Other Current Liabilities,
              Long Term Debt, Other Non-Current Liabilities, Retained Earnings, Other Equity
Balance(accountId, period, amount)                  -- actuals
Budget(accountId, period, amount)                    -- optional import
FinancialAdjustment(id, companyId, period, lines[]) -- must balance
NonFinancialMetric(id, name, period, value)
KPI(id, name, categoryId, type ∈ {Default, Non-financial, Account Watch, Divisional, Formula},
    formula, unit ∈ {currency, %, days, times, ratio}, favourableDirection ∈ {up, down},
    importance ∈ {Critical, High, Medium, Low}, active)
KPICategory  A Profitability, B Activity, C Efficiency, D Asset Usage, E Liquidity,
             F Coverage, G Gearing, H Cash Flow, I Growth, J Value
Target(kpiId, mode ∈ {constant, variable}, useBudget, monthlyValue | perMonth[])
Alert(kpiId, active, comparator, monthlyThreshold)
ThresholdCollection(id, name, frequency e.g. Quarterly, companyIds, rules[])
LibraryKPI(folder ∈ {Customer Service, Human Resources, Sales, Marketing & Business Development,
           Operations, Health & Safety, Health Care and Social Assistance, custom…}, usedByCount)
Report(id, companyId, name, period, status ∈ {Draft, Published}, sharedWith[], lastEdited, header)
ReportSection(id, reportId, title, orientation ∈ {Portrait, Landscape}, order, components[])
ReportComponent(type ∈ {Text, Chart, Table, Image, File, Commentary}, config)
ReportTemplate(id, name, predefined|custom)
Schedule(id, templateId, frequency, recipients)
Forecast(companyId, rangeYears ∈ {3,5}, rollingFrom)
Scenario(id, name, lastUpdated)        -- "Base" by default
Microforecast(id, name, category, startDate, active)
Driver(id, name, type ∈ {financial, non-financial}, values[])
ValueRule(accountId, fromPeriod, method, params, options{round, allowNegative, notes})
TimingProfile(accountId, distribution e.g. {sameMonth:100%})
Snapshot(id, createdAt, frozen results)
TaxSetting(consumptionTaxes[], withholdings[], taxExpenseAccounts[])
```

---

## 7. Module specs

### 7.1 Portfolio — Companies (`/companies`)
- Header: org logo placeholder, org name, "1 company". Green **Add ▾** button:
  - `Company` — "From accounting system or Excel" → modal "COMPANY SOURCE SYSTEM — Select the company source system": tiles **Quickbooks** ("Connect companies from Intuit QuickBooks"), **Xero**, **FreeAgent**, **MYOB**, **Sage** ("…from a Sage product"), **Google Sheets**, **Excel** ("Import a …"). Cancel button.
  - `Consolidated group` (link "Min 2. companies")
  - `Benchmark group` (Min 2. companies)
- Company block: name, "Last updated 28 days ago · Excel", `⚙ Settings`, `⋮`.
- Three big tiles with illustrations:
  - **Analysis** — "In depth insights into business performance"
  - **Reporting** — "Create and customise custom management reports"
  - **Forecasting** — "3-way forecasting and business performance planning"
- Footer links: "View a demo company", "Visit our help centre", "View latest features".

### 7.2 Insights Dashboard (`/dashboard`)
- Title + period picker. Toolbar: `Search`, `Sort`, `Filters` (Metrics, Tags, Threshold collection, Company source, Plan type), `Saved Views`, `Columns`, `Options`.
- Left summary: "COMPANIES · 1 company · 100% Pro adoption ⓘ".
- One column group per metric (max **6** selected). Each group header shows the average result plus growth; each row shows `Result (period)`, `Growth vs last month` (coloured chip) and `Trend 12 months` (sparkline).
- Metric picker ("Select metrics", searchable):
  - REVENUE & EXPENSES: Revenue, Cost of Sales, Expenses
  - PROFITABILITY: Gross Profit, Net Profit, EBITDA, Operating Profit, Gross Profit Margin, Net Income Margin, Operating Profit Margin, EBITDA Margin
  - CASH FLOW: Cash on Hand, Operating Cash Flow, Free Cash Flow, Net Cash Flow
  - ASSETS: Inventory, Current Assets, Non-Current Assets, Total Assets
  - LIABILITIES: Current Liabilities, Non-Current Liabilities, Total Liabilities, Tax Liability
  - WORKING CAPITAL: Accounts Receivable, Accounts Payable, AR Days, AP Days, Current Ratio, Inventory Days, Cash Conversion Cycle, Quick Ratio, Work in Progress, WIP Days
  - DEBT & EQUITY: Total Debt, Total Equity, Debt to Equity, Debt to Free Cash Flow Ratio, Net Assets, Return On Capital Employed, Return On Equity
- Footer: "You've reached the bottom! Would you like to add more companies?"

### 7.3 Threshold Manager (`/thresholds`)
- Subtitle "Configure thresholds to better visualise the performance of dashboard metrics." Tabs: `Thresholds` | `Companies`. Note "Currency values in {CUR} ⓘ".
- "Default thresholds — Companies not using a custom thresholds will inherit the default thresholds." Card: `Default · Quarterly thresholds · 1 company` (edit ✎, ⋮).
- "Custom threshold collections" with "+ Create a collection" and an empty state.

### 7.4 Analysis › KPIs (`kpi-numbers`)
- Controls: `Showing [25 KPIs] comparing with [Target ▾]`. Options: **Target · Last month · Same month LY**.
  - "25 KPIs" popover has two tabs, `Custom selection` | `Active KPIs`, a checklist grouped by category, and "Deselect all".
- Filter chips on the right (with counts): `All KPIs` · `On track` (green) · `Off track` (red) · `Alerts`.
- Table columns: **RESULT** (period) · **TARGET** · status icon (✓ / ✕) · **TREND** (▲/▼ + delta; sub-header "vs TARGET") · **IMPORTANCE**.
- Category header rows with a letter badge: A PROFITABILITY, B ACTIVITY, C EFFICIENCY, D ASSET USAGE, E LIQUIDITY, F COVERAGE, G CASH FLOW, H GROWTH (lettering follows the active categories).
- A red dot before a result = an alert has fired. `–` = n/a (no data).
- Footnote: "* For this metric, a result below target is favourable".
- **Default 25 KPIs and the targets seen** (targets are user inputs):

| Cat | KPI | Example target | Importance |
|---|---|---|---|
| Profitability | Total Revenue | 6,500,000 | Critical |
| | Gross Profit Margin | 35% | Medium |
| | Operating Profit Margin | 25% | High |
| | Profitability Ratio | 15% | Critical |
| | Net Profit After Tax Margin | 7% | Medium |
| Activity | Activity Ratio | 2 times | Critical |
| | Accounts Receivable Days* | 40 days | Medium |
| | Inventory Days* | 30 days | Medium |
| | Accounts Payable Days | 45 days | Medium |
| Efficiency | Return on Equity | 15% | Critical |
| | Return on Capital Employed | 12.5% | Critical |
| | Gross Margin Return on Inventory | 150% | Low |
| Asset Usage | Asset Turnover | 5 times | Medium |
| | Working Capital Absorption* | 25% | Low |
| Liquidity | Current Ratio | 2:1 | Medium |
| | Quick Ratio | 1:1 | Medium |
| Coverage | Interest Cover | 2 times | Medium |
| Cash Flow | Cash on Hand | 10,000 | Medium |
| | Cash Flow Margin | 120% | Low |
| | Net Variable Cash Flow | 0% | Medium |
| Growth | Revenue Growth | 0.41% | Critical |
| | Gross Profit Growth | 0.17% | Medium |
| | EBIT Growth | 0.17% | High |
| | Asset Change | 0.25% | Low |
| | Equity Change | 0.25% | Low |

Other library KPIs available but off: Expense-to-Revenue Ratio, Breakeven Margin of Safety, Gearing set, Value set, etc.

- **KPI detail modal** (click a row):
  - Left side: status square (green ✓ / red ✕) + KPI name. An auto-written paragraph, e.g. *"A measure of the proportion of revenue that is left after deducting all costs directly related to the sales. For each ¤100 in sales the business retains ¤40.09 after deducting the cost of sales… For this period, the gross profit margin % is above the required target of 35%."* Then the formula line (`Gross Profit Margin = Gross Profit ÷ Revenue × 100`, with an "expand" link), then a 12-month line chart with a dashed target line and a ✓/✕ marker under each month.
  - Right panel (grey): `{PERIOD}` result · `TARGET – –` · `CHANGE FROM PRIOR MONTH` · `CHANGE FROM {MON YY}` (same month last year) · `ROLLING AVG (12 MONTH STARTING…)` · `KPI IMPORTANCE`.

### 7.5 Analysis › KPI Explorer
- Controls: `Showing [25 KPIs] grouped by [Perspective]`. Chips: All KPIs / On track / Off track (n/a results are excluded from counts).
- Visual: a large **semicircular arc**. Each KPI with a result is a rotated square tile on the arc (green with "O" = on track, red with "✕" = off track). Tiles are grouped by category, with the category label printed under each group and the KPI names written radially outward.
- Centre: big **% on track** (e.g. 25% = 2 of 8), the period, and a "Sort by perspective" toggle.
- Bottom summary: "25 KPIs (17 n/a results) · 2 ON TRACK · 6 OFF TRACK".

### 7.6 Analysis › Profitability (Breakeven)
- Three header tiles: **GROSS PROFIT** · **OPERATING PROFIT** · **EBIT** (a negative value goes on a pale red tile).
- Left: breakeven chart. X = revenue level, Y = currency. Lines: Revenue (green, through origin), Total Costs (red, starts at the fixed-cost level), Fixed Costs (flat dark line, grey area under it). The intersection = breakeven (black ring); the actual point = hollow green/red rings; the profit wedge is shaded pale green. Pill labels on the chart: REVENUE, VARIABLE COSTS, FIXED COSTS.
- Right "Breakeven" panel: ● REVENUE (link "Top ten Revenue accounts") · ● TOTAL COSTS (link "Top ten Expense and COS accounts") · ● BREAKEVEN POINT · MARGIN OF SAFETY · VARIABLE COSTS "¤0.61 per ¤1 of Revenue" · FIXED COSTS.
- Error state: ⓘ icon + "Sorry, we can't load the Profitability tool" + "A breakeven point cannot be calculated when there is no revenue."

### 7.7 Analysis › Cash Flow (waterfall)
- Header tiles: **OPERATING CASH FLOW** · **FREE CASH FLOW** · **NET CASH FLOW**.
- Legend: ■ Cash Received (green) ■ Cash Spent (red). A horizontal waterfall bar chart with an axis at the top (0M, 4M, 8M). Each row has a prefix label (`ADD` / `LESS`) and its value, with ⓘ tooltips on some rows.
- Row order (exact):
  ADD Revenue · LESS Cost of Sales ⓘ · LESS Expenses ⓘ · ADD Other Income · LESS Cash Tax Paid ⓘ ·
  ADD Change in Accounts Payable · ADD Change in Other Current Liabilities · LESS Change in Accounts Receivable · LESS Change in Inventory · LESS Change in Work In Progress · LESS Change in Other Current Assets → **OPERATING CASH FLOW** ·
  LESS Change in Fixed Assets (ex. Depn & Amortisation) · LESS Change in Intangible Assets · LESS Change in Investments or Other Non-Current Assets → **FREE CASH FLOW** ·
  LESS Net Interest (after tax) · ADD Change in Other Non-Current Liabilities · LESS Dividends · ADD Change in Retained Earnings and Other Equity · ADD Change in unbalanced Balance Sheet · LESS Adjustments → **NET CASH FLOW**
- Footer check: "NET CASH FLOW CAN ALSO BE CALCULATED AS: Change in Cash on Hand ¤X (Open: ¤A, Close: ¤B) − Change in Debt ¤Y (Open: ¤C, Close: ¤D)".

### 7.8 Analysis › Growth (quadrant)
- Controls: `Up to the [Month] of [Aug 2026]` · `Comparing [EBIT vs Total Operating Investment] from [Aug 2025]`.
- Scatter/path chart. X = TOTAL OPERATING INVESTMENT, Y = EARNINGS BEFORE INTEREST & TAX. Each month is a green dot (the latest is the biggest), joined by a thick translucent grey path.
- Four quadrants, split at the starting point: **EFFICIENCY GAINS** (top-left: EBIT up, investment down) · **QUALITY GROWTH** (top-right) · **DECLINE** (bottom-left) · **STRESS** (bottom-right: investment up, EBIT down). A small 2×2 mini-map sits on the right.

### 7.9 Analysis › Trend
- Controls: `Showing [Revenue] [+]` (add a series) · `Select a predefined chart ▾`. Year filter: `Show: 2022 2023 2024 2025 2026 All`.
- Predefined charts: Income · COS & Expense · Profit · Asset · Equity · Working Capital · Cash Conversion · Liquidity · Cash Position · Cash Flow · Profit vs Cash Flow.
- "+" picker (searchable "Search for a metric"), in 4 collapsible trees:
  - **KPIs** (the 25 by category)
  - **Profit & Loss**: Revenue (– Fixed COS, – Variable COS, – Depreciation) · Cost of Sales · Gross Profit (– Fixed Expenses, – Variable Expenses, – Depreciation & Amortisation) · Expenses · Operating Profit (– Other Income, – Other Expenses) · Earnings Before Interest & Tax (– Interest Income, – Interest Expenses) · Earnings Before Tax (– Tax Expenses) · Earnings After Tax (– Adjustments) · Net Income (– Dividends) · Retained Income · OTHER: EBITDA ("Earnings Before Interest, Tax, Depn & Amort."), NOPAT, Net Interest
  - **Balance Sheet**
  - **Chart of Accounts** (every GL account)
- Line chart over all months (Jan 22 … current), with a monthly value list below.

### 7.10 Analysis › Goalseek
- Control: "Changes required to increase [Profitability Ratio] from -1.73% to [15%]" (KPI and goal are both editable).
- Progress bar: START (current value, flag above) → GOAL, hatched in between.
- Lever rows grouped into **HIGH SENSITIVITY** (axis −80%…+80%): Price ⓘ, Volume ⓘ, Variable COS, Fixed Expenses · **MEDIUM SENSITIVITY** (−800%…+800%): Variable Expenses, Other Expenses · **LOW SENSITIVITY** (−6,000%…+6,000%): Other Income.
- Each row has an editable `Change` input (default 0%) and a bar from 0% to the % change that **alone** would reach the goal (each row has its own colour). Changing the inputs moves the START marker toward the GOAL.

### 7.11 Analysis › Financials
- Controls: `View [Profit & Loss ▾] showing [Summary ▾] financials, compared with [Last month ▾]`.
  - View: Profit & Loss · Balance Sheet · Cash Flow Statement. Showing: Summary · Detailed. Compared with: Last month · Same month LY.
- **P&L columns:** PROFIT & LOSS · {Current} · {Comparison} · Variance % · Common Size (mini pie + % of revenue) · YTD.
  Rows: Revenue · Cost of Sales · **Gross Profit** · Expenses · **Operating Profit** · Other Income · Other Expenses · **Earnings Before Interest & Tax** · Interest Income · Interest Expenses · **Earnings Before Tax** · (Tax Expenses) · **Net Income**.
  Variance % colouring depends on direction (a cost going up = red; revenue going up = green).
- **Balance Sheet columns:** current · comparison · Variance ¤ · Variance % · Common Size (% of Total Assets). Red banner at top right when out of balance: "Out of balance by ¤X".
  Rows: ASSETS (Cash & Equivalents, Accounts Receivable, Inventory, Other Current Assets, **Total Current Assets**, Fixed Assets, **Total Non-Current Assets**, **Total Assets**) · LIABILITIES (Short Term Debt, Accounts Payable, Tax Liability, Other Current Liabilities, **Total Current Liabilities**, **Total Non-Current Liabilities**, **Total Liabilities**) · EQUITY (Other Equity, **Total Equity**) · **Total Liabilities & Equity**.
- **Cash Flow Statement (indirect method):** OPERATING ACTIVITIES (Net Income, Depreciation & Amortisation, Change in AP, Change in Other Current Liabilities, Change in Tax Liability, Change in AR, Change in Inventory, Change in Other Current Assets, **Cash Flow from Operating Activities**) · INVESTING ACTIVITIES (… **Cash Flow from Investing Activities**) · FINANCING ACTIVITIES (Change in Other Equity, Change in Earnings not attributable to Retained Income, Change in unbalanced Balance Sheet, Change in Short Term Debt, **Cash Flow from Financing Activities**) · Change in Cash & Equivalents · Opening Balance · Closing Balance.

### 7.12 Reports
- **List:** tabs `Drafts` | `Published`. "Draft reports are shared with [2 people]". Search, Sort. Columns: Name · Period · Last edited · Actions (⋯). Green "+ Create report" button.
- **Create wizard (2 steps):** "REPORT ORIGIN — Create a report": `Start from scratch` ("…completely blank report") | `Use a template` ("…custom or predefined template") → "CREATE REPORT FROM TEMPLATE": Template (searchable, PREDEFINED group: Advanced Forecast Analysis, Annual Performance Report, Cash Flow Analysis, Forecast Analysis, KPI Analysis, Monthly Performance Report, … plus custom ones) + Reporting period (`For the Month of Oct 2026`). Buttons: Previous / Cancel / Create.
- **Editor:**
  - Top: back, title + period, undo/redo, Preview.
  - Cover/header block: org logo, report title, `Company · [Period]`, status "Not yet published", `Edit header`, plus a paper thumbnail on the right.
  - Body = ordered **sections**, each with a title and a `Portrait section` / `Landscape section` toggle. At the end: "Add another section · Or, are you all done? [Publish report]".
  - **Charts panel:** "Showing [Revenue] charts". Categories: KPIs ›, Revenue, Costs & Expenses, Profitability, Cash Flow, Growth, Activity, Efficiency, Coverage, Liquidity, Forecasting. Revenue items: Revenue (123 number tile) · Revenue This financial year · Revenue Rolling 12 months · Revenue All time · Cumulative Revenue This financial year · Revenue Budget Projection (YTD + Rest of year budget) · Revenue Scenarios (YTD + Forecast) · Revenue This year vs last year · Revenue vs budget · Revenue vs target · Revenue Mix (Revenue & Other Income) · Revenue Breakdown (by account).
  - **Tables & Financials panel:** "Showing [Monthly ▾ / Quarterly / Yearly] [Financials ▾] tables". Types: All · Financials · Financial Snippets · Financial Trends · KPIs · KPI Trends · Forecasting. Monthly table presets: This month · This month vs Last month · This month + Last 3 months · This month + YTD · This month vs budget.
  - **Files & Media:** Insert Image · Insert File. "Report media capacity 0 / 50MB". Drag & drop tip.
  - **Layouts:** prebuilt multi-component layouts per category (e.g. "3 Revenue Charts", "5 Revenue Charts", "Revenue Forecast", "Revenue Forecast Projection"), split into PORTRAIT / LANDSCAPE.
  - **Commentary Writer (Beta)**: "+ New Chat", "0 components selected — Give the AI context by selecting components…", suggestion chips: *Summarise key insights* · *Analyse variances, fluctuations and trends.* · *Generate questions for stakeholders*; prompt box with a "Context: [0 components]" picker and a send button.
  - Example template sections ("Advanced Forecast Analysis"): Revenue Charts · Business Plan (Upcoming Twelve) — Business Roadmap Gantt · Microforecasts & Account Detail · Cash Flow Analysis (OCF/FCF/NCF tiles with "% from last month"; Cash Flow Trend; Cash & Receivables; Profit vs Cash Flow) · Rolling Twelve Month Forecast (P&L) · Forecast Projection Charts · Scenario Analysis (quarterly P&L) · Forecast Annual Summary (5-year P&L by account) · Three-way Forecast (monthly P&L + BS + CF) · Primary Cash Account Detail (opening → P&L accounts → other → closing) · Forecast Assumptions (Assumptions notes, Forecast Drivers, Adjustments).
- **Schedules:** empty state "No schedules — Automate the creation and sending of your recurring reports." [Create schedule].
- **Excel reports:** Financial results · KPI results · Detailed financial variance · Forward projection for this FY (Not available) · Financial results (in the product's own Excel import format) · Non-financial KPI Results (Not available) · Budget (Not available) · Three-way forecast. Each has a download icon.

### 7.13 Forecast
- Tabs: `Profit & Loss` · `Balance Sheet` · `Cash Flow` · `Drivers`. Controls: `Showing [Month] rolling from [Oct 2026]`. Top-right icons: comments, export/share, view options.
- **Grid:** frozen left column with a search box ("Type here to search…") and collapsible class groups (Revenue ▾ › accounts › Total). The month columns scroll horizontally (the current month is shaded). A **sticky bottom row "Cash on Hand"** runs across all months, with a coloured bar over it (red when ≤0, green when >0).
- Each account row can expand into `Baseline` and scenario rows (e.g. "Base"). A small badge ("1 ⚖") shows how many rules apply.
- **Row drawer** (click an account): tabs `Rule Timeline` | `Settings`.
  - *Baseline Value Rules* (+) — card e.g. "Smart Prediction — Linear regression".
  - *Timing Profiles* (+) — e.g. "Collected in same month — 100% in same month" (turns P&L into cash/AR/AP timing).
  - **Create rule:** "Applied on {Account} from [Nov 2026]". Calculation method:
    - **Smart Prediction** — "Calculate values based on statistical analysis of historical actuals." Sub-options: [Linear regression ▾] of the last [12 months], ☐ Include seasonal adjustments
    - **Link to previous period** — "Use values from previous periods & add an optional increase/decrease."
    - **Constant / Growing** — "Use a constant value for all cells, or add a figure with an increase/decrease %."
    - **Formula / Drivers** — "Build a formula based on other forecast values, prior actuals, or Driver data."
    - **Link to Budget** — "Use values from your budget (managed in company settings)."
    - Options: ☐ Round figure · ☐ Allow negative values · Notes. Buttons: Create rule / Cancel.
- **Drivers:** empty state "Create Drivers — Achieve even greater control over your forecast calculations by building financial or non-financial Drivers and applying them in your custom formulas." Excel import icon and "+".
- **Business Roadmap:** "Showing [All categories]", a Gantt timeline by month, rows = Base + microforecasts, "+ Create Microforecast" → modal (Name, Category (optional: No category / + Add new category…), Starting date). Cash on Hand sticky row.
- **Scenarios** slide-out: "Sorting by [Recently Updated]", list (Base · Last updated 24 days ago · ⋮), "+ Create Scenario".
- **Settings › General:** Forecast Range ("3 year forecast — Forecasting the current financial year plus 3 years", link "Extend to 5 years") · Downloads (Forecast: P&L, BS and CF · Value Audit: value rules, timing profiles, journals, drivers, schedules and notes) · Snapshots ("Capture static forecast results to be used as comparative data in reports", Create a snapshot) · **Residual Drawdown** ("…applies your chosen timing profiles to opening AR and AP balances to draw them down…": AR → Cash paid over 6 months; AP → Cash paid over 6 months) · Danger zone (Reset baseline, Delete forecast).
- **Settings › Accounts:** Default Account Linkages (AR, AP, Cash, Current Earnings, Retained Earnings, Unearned Revenue (Prepaid), Prepaid Expenses) · Loan Repayment Defaults (Long/Short Term Debt → Interest Rate Driver, "View in Drivers grid") · Account Settings per P&L class (Revenue · 4 accounts, Cost of Sales · 2, Expenses · 9 …) each with Pre-payments / Accrued payments / Cash / final posting.
- **Settings › Tax:** Consumption Taxes (e.g. GST/VAT, Sales Tax) [Add type] · Withholdings (e.g. PAYG, Medicare, leave provisions) [Add type] · Tax expense accounts [Add account].

### 7.14 Company Settings (numbered setup wizard 1–6)
Left nav: company card + `1 Source Data` (Financials, Budgets, Non-financials) · `2 Company Profile` · `3 Chart of Accounts` · `4 KPIs` · `5 Targets` · `6 Alerts` · `Copy settings`.
- **Financials:** Source Data card (Excel icon, "Last updated 28 days ago ⓘ", [Update data]); Date range "January 2022 – October 2026" (Add periods / Remove periods); Financial Adjustments ("Create balanced adjustments to accurately present your financial data", Add adjustment); Default Account Linkages (Retained Earnings — "Movements created in your selected Current Earnings account will automatically be moved to this account at the end of financial year…"; Current Earnings).
- **Budgets:** "Importing a financial budget is optional. To get started, add a budget." [ADD A BUDGET].
- **Company Profile:** logo; Financial Year (start month / end month); Terminology (English (UK)); Currency; Company size; **AI business context** (Goals, Strategy, Market conditions, Current position, Other, plus a disclaimer); Default rates (Tax rate %, Interest rate %, Weighted cost of capital %); Industry classifications (Division › Subdivision › Group › Class).
- **Chart of Accounts:** tabs P&L | Balance Sheet; Search, Filters, Reorder, Options. Class blocks with a letter badge (R Revenue, C Cost of Sales, E Expenses, … I Interest Income, I Interest Expenses, T Tax Expenses, A Adjustments, D Dividends), "+ Add heading" per class. Each account row shows a behaviour tag (`VARIABLE` / `FIXED` / `DEPRECIATION`) and a `Reclassify` action.
- **KPIs:** "Select from a range of standard financial KPIs or create your own KPIs." [Create category] [Add a KPI ▾]. "25 active KPIs ⓘ", "Non-financial KPI results ↗". Columns: Type · Importance (pill dropdown) · Status (toggle) · Actions ⋮. Categories A–J: Profitability, Activity, Efficiency, Asset Usage, Liquidity, Coverage, Gearing, Cash Flow, Growth, Value.
  - Custom KPI wizard: "What type of KPI would you like to add?" → **Non-financial** · **Account Watch** ("Watch any account from your GL (e.g. Sales, Assets, Expenses)") · **Divisional** ("Track your financial metrics by division") · **Formula** ("Build a KPI formula using financial accounts and other variables").
- **Targets:** "Set a monthly performance target for each KPI." "Use [constant ▾] target values" (Constant — "Use same target every month" | Variable — "Custom monthly variable targets"). Columns: Type · Use budget ⓘ · Monthly target (unit badge ¤ / % / times / days + input).
- **Alerts:** "Turn on alerts and specify monthly alert thresholds." Columns: Alert name · Active status (toggle) · Monthly threshold. Alerts: Total Revenue is less than · Gross Profit Margin % is less than · Operating Profit Margin % is less than · Profitability % is less than · Net Profit After Tax % is less than · Breakeven Safety Margin is less than · Accounts Receivable Days exceed · Inventory Days exceed · Work in Progress Days exceed · Accounts Payable Days is less than · Cash Conversion Cycle exceeds · Debt-to-Equity exceeds. Note: "Alert notifications are shown in the KPI tool and in the alerts dashboard in the Analysis tools."

### 7.15 Organisation Admin
Left nav: Organisation profile · Terminology · Tags · AI Features · Account / Billing · User management · Report defaults · Security · Beta features · Help centre.
- **Profile:** logo, Country, State/Province, Timezone, Address, Phone, Subscription plan ("Current {product} Plan: 1 company"), Branding (Website URL, Brand colour), **Terms of Use (Disclaimer)** shown to users on first login (default text: the firm "has relied upon the unaudited financial and non-financial information provided…"; 1,093 characters remaining).
- **Terminology:** Default Terminology (Auto-detection by company type and region); Custom Terminologies (Add); Predefined: English (UK), English (US), Not-For-Profit (with usage counts).
- **Tags:** Add Category, Add Tag; filters for company use and category.
- **Account / Billing:** tabs Account | Billing | Invoices. Account Subscription: "Pro · Starter base plan · 1 company [Change plan]"; "Portfolio · No plan active [Select a plan]"; "Total monthly cost — Next invoice total (excluding taxes) $59.00 / month"; Danger Zone (Transfer ownership, Cancel subscription — "permanently delete all companies… after one month").
- **User management:** Invite a person; tabs Active users | Pending invites; columns Name · Email · Role (ADMIN / EDITOR) · Last login · Security · Actions.
- **Report defaults:** Paper size (A4); Analysis report footer ("Company Name (Period Name) - Prepared by {Org}", character limit); Report disclaimer (include by default; only Admins may remove it).
- **Security:** Enforce Two-Factor Authentication.
- **Beta features:** "Company Source Data Settings – Financials & Non-financials"; "Bulk Excel Import And Update".
- **KPI Library:** folders (Customer Service, Human Resources, Sales, Marketing & Business Development, Operations, Health & Safety, Health Care and Social Assistance, + Create folder); table Name · Type (DEFAULT) · Used by # companies · Actions. Examples: Number of Complaints, Number of Compliments, Customer Loyalty, Customer Attrition, Customer Satisfaction, % of customers given satisfaction surveys, Staff Turnover, Staff Retention, Job Satisfaction, Absenteeism, Average Training days per Employee, Number of Staff Performance Reviews, % of staff who receive regular performance reviews.

---

## 8. Calculation engine (all formulas as the app shows them)

Notation: `days` = number of days in the selected period (the app shows this as "Month starting … Length"). `ann(X) = X × 365 ÷ days` (annualise). `[Opening]` = balance at the start of the period. `[Prior]` = previous comparable period.

### 8.1 P&L cascade
```
Gross Profit                 = Revenue − Cost of Sales
Operating Profit             = Gross Profit − Expenses
EBIT                         = Operating Profit + Other Income − Other Expenses
Earnings Before Tax          = EBIT + Interest Income − Interest Expenses
Earnings After Tax           = EBT − Tax Expenses
Net Income                   = EAT − Adjustments
Retained Income              = Net Income − Dividends
EBITDA                       = EBIT + Depreciation & Amortisation
NOPAT                        = EBIT × (1 − tax rate)
Net Interest                 = Interest Expenses − Interest Income
Variance %                   = (Current − Comparison) ÷ |Comparison| × 100   ("–" if comparison = 0)
Common Size (P&L)            = Line ÷ Revenue × 100
Common Size (BS)             = Line ÷ Total Assets × 100
YTD                          = Σ months from FY start to the selected month
```

### 8.2 Balance Sheet
```
Total Current Assets  = Cash + AR + Inventory + WIP + Other CA
Total Assets          = TCA + Fixed + Intangibles + Investments/Other NCA
Total Liabilities     = (STD + AP + Tax Liab + Other CL) + (LTD + Other NCL)
Total Equity          = Retained Earnings + Other Equity (+ current earnings)
Out of balance by     = Total Assets − (Total Liabilities + Total Equity)   -> red banner if ≠ 0
Operating Working Capital = AR + Inventory + WIP − AP
Total Invested Capital    = Total Equity + Total Debt   (debt = STD + LTD)
Total Operating Investment ≈ Operating Working Capital + Fixed Assets   (x-axis of the Growth tool)
```

### 8.3 KPI formulas (exact)
| KPI | Formula |
|---|---|
| Gross Profit Margin | Gross Profit ÷ Revenue × 100 |
| Operating Profit Margin | Operating Profit ÷ Revenue × 100 |
| Profitability Ratio | EBIT ÷ Revenue × 100 |
| Net Profit After Tax Margin | Earnings After Tax ÷ Revenue × 100 |
| Activity Ratio | ann(Revenue) ÷ Total Invested Capital |
| Accounts Receivable Days* | AR × days ÷ Revenue |
| Inventory Days* | Inventory × days ÷ COS |
| Accounts Payable Days | AP × days ÷ COS |
| Return on Equity | ann(Net Income) ÷ Total Equity[Opening] × 100 |
| Return on Capital Employed | ann(EBIT) ÷ Total Invested Capital × 100 |
| Gross Margin Return on Inventory | ann(Gross Profit) ÷ ((Inventory + Inventory[Opening]) ÷ 2) × 100 |
| Asset Turnover | ann(Revenue) ÷ Total Assets |
| Working Capital Absorption* | Operating Working Capital ÷ ann(Revenue) × 100 |
| Current Ratio | Total Current Assets ÷ Total Current Liabilities (shown "x:1") |
| Quick Ratio | (Cash & Equivalents + AR) ÷ Total Current Liabilities |
| Interest Cover | EBIT ÷ (Interest Exp − Interest Income) |
| Cash on Hand | Cash & Equivalents (closing) |
| Cash Flow Margin | Operating Cash Flow ÷ Revenue × 100 |
| Net Variable Cash Flow | (ann(Rev) − ann(Variable COS) − ann(Variable Exp) − Operating WC) ÷ ann(Rev) × 100 |
| Revenue / Gross Profit / EBIT Growth | (X − X[Prior]) ÷ X[Prior] × 100 |
| Asset Change / Equity Change | (X − X[Opening]) ÷ X[Opening] × 100 |
| Cash Conversion Cycle (dashboard) | AR Days + Inventory Days + WIP Days − AP Days |
| Debt to Equity | Total Debt ÷ Total Equity × 100 |

### 8.4 KPI status & trend logic
```
favourable = (direction == up)   ? result >= target : result <= target   # "*" KPIs use direction = down
status     = result is null ? "n/a" : favourable ? "On track" : "Off track"
trend (vs target):
   unit == currency : (result − target) ÷ target × 100   -> shown as %
   unit == %        : result − target                    -> percentage points
   unit == days/times: result − target                   -> same unit
arrow = ▲ if trend > 0 else ▼ ; colour = green if favourable else red
alert fires when the alert's comparator(result, threshold) is true -> red dot + counted in "Alerts"
KPI Explorer % on track = OnTrack ÷ (OnTrack + OffTrack)   (n/a excluded)
Rolling avg (12m) = mean of the last 12 monthly results
```

### 8.5 Breakeven (Profitability tool)
```
Variable costs  = Variable COS + Variable Expenses            (by account behaviour tag)
Fixed costs     = Fixed COS + Fixed Expenses + Depreciation
Total costs     = COS + Expenses  (= Variable + Fixed)
VC ratio        = Variable costs ÷ Revenue                     -> "¤0.61 per ¤1 of Revenue"
Contribution margin ratio = 1 − VC ratio
Breakeven point = Fixed costs ÷ (1 − VC ratio)
Margin of safety = Revenue − Breakeven point
Operating Profit = Revenue − Total costs
If Revenue = 0  -> error "A breakeven point cannot be calculated when there is no revenue."
Chart: revenue line y = x ; total cost line y = Fixed + VCratio × x ; fixed line y = Fixed
```

### 8.6 Cash-flow waterfall (direct-style, built from P&L + BS movements)
```
Δ = Closing − Opening for each BS line ; t = tax rate
CashTaxPaid      = TaxExpense − ΔTaxLiability + t × NetInterest       (shown as LESS)
OCF = Revenue − (COS − Depn in COS) − (Expenses − D&A + Other Expenses) + Other Income − CashTaxPaid
      + ΔAP + ΔOtherCL − ΔAR − ΔInventory − ΔWIP − ΔOtherCA
FCF = OCF − ΔFixedAssets(ex D&A) − ΔIntangibles − ΔInvestments/OtherNCA
NCF = FCF − NetInterest × (1 − t) + ΔOtherNCL − Dividends + ΔRetainedEarnings&OtherEquity
      + ΔUnbalancedBS − Adjustments
Check: NCF = ΔCash − ΔDebt
```
(Verified against live data: every line reconciled to the unit.)

### 8.7 Cash Flow Statement (indirect)
```
CFO = Net Income + D&A + ΔAP + ΔOtherCL + ΔTaxLiab − ΔAR − ΔInv − ΔOtherCA
CFI = −ΔFixed Assets (ex D&A) …
CFF = ΔOtherEquity + ΔEarnings not attrib. to RE + ΔUnbalanced BS + ΔShortTermDebt (+ΔLTD)
ΔCash = CFO + CFI + CFF ; Closing = Opening + ΔCash
```

### 8.8 Goalseek (lever needed alone to reach goal g on Profitability Ratio = EBIT/Revenue)
```
R = Revenue, E = EBIT, CM = R − Variable costs, gR = g × R
Price  p = (gR − E) ÷ (R × (1 − g))          # revenue up, costs unchanged
Volume v = (gR − E) ÷ (CM − gR)              # revenue and variable costs scale together
Variable COS change c = (E − gR) ÷ VariableCOS   (negative = cut)
Fixed Expenses change = (E − gR) ÷ FixedExpenses
Variable Expenses / Other Expenses: same pattern with their own base
Other Income change   = (gR − E) ÷ OtherIncome
Sensitivity band = how large the required % is (High < 100%, Medium < 1,000%, Low beyond)
Combined: apply all inputs, recompute ratio, move START marker
```

### 8.9 Growth quadrant
```
For each month m from the start month to the selected month:
  x_m = Total Operating Investment_m ; y_m = EBIT_m (annualised/trailing view)
Quadrant vs the start point (x0, y0):
  y↑ x↓ EFFICIENCY GAINS | y↑ x↑ QUALITY GROWTH | y↓ x↓ DECLINE | y↓ x↑ STRESS
```

### 8.10 Forecast engine
```
Baseline cell value per rule:
  Smart Prediction  : OLS linear regression on the last N months (default 12) [+ seasonal index]
  Link to previous  : value[t] = value[t−k] × (1 + growth%) + fixed delta
  Constant/Growing  : value[t] = base × (1 + g)^(t)  or a constant
  Formula/Drivers   : expression over forecast lines, prior actuals, driver series
  Link to Budget    : value[t] = budget[t]
  Options: round, allow negative (else floor at 0)
Timing profile: splits each P&L amount into cash in month 0..n (rest -> AR/AP, or prepaid/accrued)
Residual drawdown: opening AR/AP not covered by profiles -> straight-line over N months (default 6)
3-way link: P&L -> (timing) -> Cash, AR, AP ; Net Income -> Current Earnings -> Retained Earnings at FY end
Cash on Hand[t] = Cash[t−1] + NetCashFlow[t]   (sticky footer row; red if ≤ 0)
Range = current FY + 3 years (extendable to 5) ; rolling from the current month
Scenario = baseline + microforecast adjustments ; Snapshot = frozen copy for comparisons
```

---

## 9. Worked synthetic example (one month, 30 days, t = 22.5%)

| Input | Value |
|---|---|
| Revenue | 1,000,000 |
| COS: variable 545,000 · depreciation 5,000 | 550,000 |
| Expenses: variable 50,000 · fixed 245,000 | 295,000 |
| Other income / other expenses | 10,000 / 30,000 |
| Interest income / expense | 1,000 / 21,000 |
| Tax expense | 25,000 |

Results:
- Gross Profit 450,000 (GPM 45.00%) · Operating Profit 155,000 (OPM 15.50%) · EBIT 135,000 (Profitability Ratio 13.50%) · EBT 115,000 · EAT 90,000 (NPAT margin 9.00%).
- Variable costs = 545,000 + 50,000 = 595,000 → VC ratio 0.595 → "¤0.60 per ¤1 of Revenue". Fixed = 245,000 + 5,000 = 250,000. Breakeven = 250,000 ÷ 0.405 = **617,284**. Margin of safety = **382,716**. Check: 1,000,000 − 595,000 − 250,000 = 155,000 = Operating Profit ✓.
- Goalseek to 15%: gR = 150,000, gap = 15,000 → Price +1.76% (15,000 ÷ 850,000) · Volume +5.88% (15,000 ÷ (405,000 − 150,000)) · Variable COS −2.75% · Fixed Expenses −6.12%.
- KPI vs target 35% GPM → On track, trend ▲ +10.00 pp.

---

## 10. States & messages (exact text)
- Profitability with no revenue: "Sorry, we can't load the Profitability tool / A breakeven point cannot be calculated when there is no revenue."
- BS imbalance: "Out of balance by ¤X" (red, top right of the Balance Sheet).
- KPI Explorer: "(17 n/a results)".
- Report microforecast: "The microforecast chosen is inactive on your Main Forecast or has been removed."; "There are no microforecasts to show."; "There is no data available for this breakdown".
- Notifications: "You're all up to date with your notifications, nice!"
- Dashboard bottom: "You've reached the bottom! Would you like to add more companies?"
- Danger actions always sit in a "Danger zone" block with a warning sentence.

---

## 11. Inputs → Processing → Outputs

| Input | Processing | Output |
|---|---|---|
| GL trial balances by month (integration/Excel) | map to classes + behaviour | standard P&L/BS/CF |
| Budgets (optional) | align by account/month | vs-budget tables/charts, target source, forecast rule |
| Non-financial data | store as metric series | non-financial KPIs |
| KPI selection, importance, targets, alerts | status/trend engine | KPI table, Explorer, alerts, dashboard |
| Company profile rates (tax, interest, WACC) | cash tax, NOPAT, value KPIs | cash-flow waterfall, value metrics |
| Forecast rules, timing, drivers, scenarios | 3-way projection | forecast grid, cash on hand, forecast reports |
| Report template + period | assemble components | PDF / online report / scheduled send |
| AI business context + selected components | LLM prompt | commentary text inside reports |

---

## 12. Key user journeys
1. **Onboard a client:** Add → Company → pick source → map accounts (Settings 1–3) → choose KPIs (4) → set targets (5) → alerts (6).
2. **Monthly review:** choose the period → KPIs (on/off track) → Profitability (breakeven) → Cash Flow (where cash went) → Financials (variance) → Goalseek (what needs to change).
3. **Board pack:** Reports → Create → template → add charts/tables/AI commentary → Publish / Download PDF / Schedule.
4. **Forecast:** Forecast → set rules per account → timing profiles → drivers → scenarios/microforecasts → read Cash on Hand → snapshot → forecast report.
5. **Portfolio monitoring:** Insights Dashboard → choose 6 metrics → thresholds → find clients needing attention.

---

## 13. Build skeleton for Claude Code

**Stack (suggested):** Next.js (App Router) + TypeScript + Tailwind; Postgres (Prisma); charts in D3/Visx (custom waterfall, arc, quadrant); PDF via headless Chromium; background jobs (BullMQ) for syncs, schedules and forecasts; LLM API for Commentary Writer.

```
/app
  /(portfolio)/companies  /dashboard  /thresholds
  /company/[id]/analysis/{kpi-numbers,kpi-explorer,profitability,cashflow,growth,trend,goalseek,financials}
  /company/[id]/reporting/{page, published, schedules, excel-reports, report/[rid]/edit}
  /company/[id]/forecasting/{page, balance-sheet, cash-flow, drivers, roadmap, settings}
  /company/[id]/settings/{source-data, budgets, non-financials, profile, chart-of-accounts, select-kpis, set-targets, set-alerts}
  /administration/{profile, terminology, tags, account, people, reporting, security, beta-features, kpi-library, delete}
/components
  shell/{TopBar, IconRail, PeriodSentencePicker, MonthYearPopover, SentenceSelect}
  kpi/{KpiTable, KpiRow, KpiModal, KpiArcExplorer, StatusIcon, ImportanceChip}
  charts/{BreakevenChart, CashWaterfall, GrowthQuadrant, TrendLine, Sparkline, MiniPie, GoalseekBars}
  financials/{StatementTable, VarianceCell, CommonSizeCell, OutOfBalanceBanner}
  report/{Editor, Section, ComponentPalette, ChartsPanel, TablesPanel, LayoutsPanel, CommentaryWriter}
  forecast/{ForecastGrid, CashOnHandRow, RuleDrawer, RuleForm, TimingProfileForm, RoadmapGantt, ScenarioPanel}
/lib/calc
  pl.ts bs.ts cashflow.ts kpis.ts breakeven.ts goalseek.ts growth.ts forecast/{rules.ts, timing.ts, threeway.ts}
/lib/integrations/{quickbooks, xero, freeagent, myob, sage, gsheets, excel}.ts
/prisma/schema.prisma   (entities in §6)
```

**API (REST):**
```
GET  /api/companies                     POST /api/companies {source}
GET  /api/companies/:id/financials?type=pl|bs|cf&period=&compare=prior|ly&layout=summary|detailed
GET  /api/companies/:id/kpis?period=&compare=target|prior|ly
GET  /api/companies/:id/breakeven?period=
GET  /api/companies/:id/cashflow-waterfall?period=
GET  /api/companies/:id/growth?to=&from=
GET  /api/companies/:id/trend?series[]=&years=
POST /api/companies/:id/goalseek {kpi, goal, changes{}}
CRUD /api/companies/:id/{accounts,targets,alerts,budgets,adjustments}
CRUD /api/companies/:id/reports  POST /api/reports/:rid/publish  GET /api/reports/:rid/pdf
CRUD /api/companies/:id/forecast/{rules,timing,drivers,scenarios,microforecasts,snapshots}
POST /api/reports/:rid/commentary {componentIds, prompt}
GET  /api/dashboard?metrics[]=&tags[]=&period=
```

**Acceptance tests (use §9 numbers):** breakeven 617,284; MoS 382,716; GPM 45%; goalseek price 1.76%; NCF = ΔCash − ΔDebt for any dataset; BS imbalance banner shows when A ≠ L + E.

---

## 14. Clues ranked for the guessing tool (strongest first)
1. "3-way forecasting" + KPI targets + breakeven + Goalseek + Growth quadrant (Efficiency Gains / Quality Growth / Decline / Stress) in one product.
2. Sold to advisory firms: portfolio of client companies, consolidated & benchmark groups, white-label disclaimer and branding.
3. Integrations: QuickBooks, Xero, FreeAgent, MYOB, Sage, Google Sheets, Excel (an Australia/UK-centric mix).
4. "Pty Ltd" legal entity + UK spelling + GST/PAYG/Medicare examples in tax settings → Australian origin.
5. Microforecasts, Business Roadmap, Drivers, Smart Prediction (linear regression), Timing Profiles, Residual Drawdown, Value Audit.
6. KPI Explorer semicircle and the cash-flow ADD/LESS waterfall.
7. Commentary Writer (Beta) labelled as powered by the parent group's AI.
8. Pricing: per company, $59/month Pro, separate Portfolio plan.
