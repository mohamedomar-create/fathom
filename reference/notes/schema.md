# data.json schema

```json
{
  "company": "Sample Trading Co",
  "currency": "EGP",
  "fy_start_month": 1,
  "tax_rate": 0.225,
  "title": "Monthly Performance Report",
  "prepared_by": "Advisory Team",
  "period": "2026-09",
  "source": "Odoo export, Sep 2026",
  "targets": {"total_revenue": 950000, "gpm": 40, "profit_ratio": 15},
  "importance": {"gpm": "Critical"},
  "commentary": {"summary": "...", "kpis": "...", "cashflow": "..."},
  "notes": ["Any adjustment you made, shown on the Basis of Preparation page"],
  "brand": {"accent": "#0F6E5A", "accent_dark": "#0A4F40", "bar": "#1B2A2F"},
  "logo_data_uri": "data:image/png;base64,...",
  "disclaimer": "...",
  "months": [{"period": "2026-08", "pl": {...14 keys}, "bs": {...16 keys}}]
}
```

- `months` needs both `pl` and `bs` for every month, sorted or not (the builder sorts). Missing keys count as 0. All amounts are positive as normally presented (costs positive, liabilities positive). Fewer than 13 months works but growth and year-on-year views are limited.
- `period` defaults to the latest month. Choose an earlier month to report on history.
- `commentary` keys: `summary`, `kpis`, `profitability`, `cashflow`, `pl`, `bs`, `trend`, `growth`, `goalseek`.
- `brand` recolours the accent (green by default), its dark variant and the top bar. Chart strokes for good and bad stay green and red on purpose, so meaning does not change with branding.
- `importance`: `Critical`, `High`, `Medium` or `Low`; drives the "critical KPIs off target" finding.

## P&L keys (14)
`revenue, cos_variable, cos_fixed, cos_depreciation, exp_variable, exp_fixed, exp_depreciation, other_income, other_expenses, interest_income, interest_expenses, tax_expenses, adjustments, dividends`

## Balance sheet keys (16)
`cash, ar, inventory, wip, other_ca, fixed_assets, intangibles, investments, std, ap, tax_liab, other_cl, ltd, other_ncl, retained_earnings, other_equity`

Balance rule: assets = `std + ap + tax_liab + other_cl + ltd + other_ncl + retained_earnings + other_equity`.

## P&L cascade
Gross profit = revenue - cost of sales. Operating profit = gross profit - expenses. EBIT = operating profit + other income - other expenses. EBT = EBIT + interest income - interest expenses. EAT = EBT - tax. Net income = EAT - adjustments. EBITDA = EBIT + depreciation.

## KPI keys (targets use the same keys; defaults in brackets)
Profitability: `total_revenue`, `gpm` (35), `opm` (15), `profit_ratio` = EBIT/revenue (10), `npat` (7).
Activity: `activity` (2 times), `ar_days` (45, lower is better), `inv_days` (60, lower better), `ap_days` (45, higher better).
Efficiency: `roe` (15), `roce` (12.5), `gmroi` (150). Asset usage: `asset_turn` (2), `wca` (25, lower better).
Liquidity: `current` (2), `quick` (1). Coverage: `int_cover` (3). Cash: `cash`, `cf_margin` (10).
Growth: `rev_growth`, `gp_growth`, `ebit_growth` (2 each), `asset_change`, `equity_change` (1 each).

Monthly ratios that need a year (ROE, ROCE, turnover) are annualised: x365 / days in month. Days KPIs use days in the month. Percent targets are in percent (15 means 15%).
