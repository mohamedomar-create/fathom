# Troubleshooting messy data

| Symptom | Likely cause | Fix |
|---|---|---|
| "Balance sheet out of balance" by roughly YTD net profit, growing through the year then dropping in January | Source BS leaves current-year profit unclosed | `--close-earnings` |
| Out of balance by a constant amount | Missing account (opening balance equity, suspense) or a mis-mapped line | Find the unmapped or low-confidence line; add to mapping CSV. Last resort `--plug-equity` and disclose |
| Out of balance by small amounts (under 2) | Rounding in source | Ignore |
| Revenue looks 10x too high or grows all year then falls in January | Cumulative (YTD) columns | `--ytd yes` (auto detects most cases) |
| Revenue negative | Trial-balance signs (credits negative) | Auto-flipped and reported; confirm in "Sign changes" |
| Costs negative | Costs shown in brackets | Auto-flipped and reported |
| "No period columns found" | Dates as text in unusual format, months in rows not columns, or merged header cells | Re-shape: unmerge, put one period per column header. Long format (Account, Date, Amount) is also read |
| Two columns for the same month | Actual and Budget side by side | Budget, forecast and variance columns are skipped by header text; check the "Columns skipped" list |
| P&L months differ from BS months | Different date ranges | Only months in both are used; ask for the missing ones |
| Odoo / QuickBooks / Xero export | Usually a TB or P&L by month with account codes | Codes in the label column are ignored; check the mapping review |
| Arabic labels | Supported in the keyword rules | Check low-confidence lines; add Arabic labels to a mapping CSV |
| Only annual figures supplied | Report is monthly | Say so. An annual-only pack is possible but loses trend, growth and annualisation; ask for monthly detail |
| KPI shows n/a | Needed input is zero (no revenue, no debt, no inventory) | Expected; leave as n/a |

## Fresh check after any fix
1. Re-run ingest and read the report again.
2. Compare one revenue figure and closing cash to the source by eye.
3. Rebuild; require `bs_imbalance` = 0 and `ncf_check` = 0.
