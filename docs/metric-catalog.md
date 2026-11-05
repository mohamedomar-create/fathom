# Metric catalog

The KPI engine's definitions, generated from `KPI_DEFS` in `src/lib/engine/kpis.ts`. A unit test
(`tests/unit/metric-catalog.test.ts`) fails when a KPI is added, removed or renamed without this file being regenerated,
so the catalog and the code can't drift apart.

**Rules every metric follows** (see `docs/erp-universal-analytics-reference.md` §7):
- Calculated deterministically from the stored books (account classes), never by AI.
- Time basis: the selected period (month, quarter, year to date, financial year, trailing twelve months); part months use
  the days covered (`asOf`) and compare like-for-like with the same days of the prior period.
- Currency: the company's own currency; nothing is summed across currencies.
- Tolerance for ties and checks: 1 unit of the currency (`src/lib/tolerance.ts`).
- A metric whose inputs are missing shows as not available, never as zero or as a fabricated figure.

| Key | Name | Category | Unit | Direction | Formula | What it shows |
|---|---|---|---|---|---|---|
| `total_revenue` | Total Revenue | Profitability | cur | higher is better | Total Revenue = Sum of all revenue accounts | The value of sales recognised in the period. |
| `gpm` | Gross Profit Margin | Profitability | % | higher is better | Gross Profit Margin = Gross Profit ÷ Revenue × 100 | A measure of the proportion of revenue that is left after deducting all costs directly related to the sales. |
| `opm` | Operating Profit Margin | Profitability | % | higher is better | Operating Profit Margin = Operating Profit ÷ Revenue × 100 | The share of revenue left after cost of sales and operating expenses. |
| `profit_ratio` | EBIT Margin | Profitability | % | higher is better | EBIT Margin = EBIT ÷ Revenue × 100 | Earnings before interest and tax as a share of revenue: how much of each sale becomes operating profit. |
| `npat` | Net Profit After Tax Margin | Profitability | % | higher is better | Net Profit After Tax Margin = Earnings After Tax ÷ Revenue × 100 | What is left for the owners from each sale after every cost, interest and tax. |
| `activity` | Activity Ratio | Activity | times | higher is better | Activity Ratio = Annualised Revenue ÷ Average Invested Capital (equity + borrowing) | How many times a year the capital invested in the business is turned into sales. |
| `ar_days` | Accounts Receivable Days | Activity | days | lower is better | Accounts Receivable Days = Average Accounts Receivable ÷ (1 + VAT rate) × Days ÷ Revenue (VAT-adjusted) | How long customers take, on average, to pay. Receivables include VAT and revenue does not, so they are taken net of VAT at the company's rate (14% unless set in the company profile). |
| `inv_days` | Inventory Days | Activity | days | lower is better | Inventory Days = Average Inventory × Days ÷ Cost of Sales (before depreciation) | How long stock sits before it is sold. |
| `ap_days` | Accounts Payable Days | Activity | days | higher is better | Accounts Payable Days = Average Accounts Payable ÷ (1 + VAT rate) × Days ÷ Cost of Sales (before depreciation) (VAT-adjusted) | How long the business takes, on average, to pay its suppliers. Payables are taken net of VAT at the company's rate. |
| `roe` | Return on Equity | Efficiency | % | higher is better | Return on Equity = Annualised Net Income ÷ Average Total Equity × 100 | The annual return the owners earn on the equity they have in the business, on the average equity over the period. Not measured when average equity is zero or negative. |
| `roce` | Return on Capital Employed | Efficiency | % | higher is better | Return on Capital Employed = Annualised EBIT ÷ Average Invested Capital (equity + borrowing) × 100 | Operating return on all capital invested, from owners and lenders. |
| `gmroi` | Gross Margin Return on Inventory | Efficiency | % | higher is better | GMROI = Annualised Gross Profit ÷ Average Inventory × 100 | Gross profit earned for each unit of money tied up in stock. |
| `asset_turn` | Asset Turnover | Asset Usage | times | higher is better | Asset Turnover = Annualised Revenue ÷ Average Total Assets | How much revenue each unit of assets generates in a year. |
| `wca` | Working Capital Absorption | Asset Usage | % | lower is better | Working Capital Absorption = Operating Working Capital ÷ Annualised Revenue × 100 | How much working capital (receivables + stock − payables) each unit of annual sales needs. |
| `current` | Current Ratio | Liquidity | ratio | higher is better | Current Ratio = Total Current Assets ÷ Total Current Liabilities | Short-term assets available to cover short-term bills. |
| `quick` | Quick Ratio | Liquidity | ratio | higher is better | Quick Ratio = (Cash & Equivalents + Accounts Receivable) ÷ Total Current Liabilities | Cash and receivables available to cover short-term bills, without relying on stock. |
| `int_cover` | Interest Cover | Coverage | times | higher is better | Interest Cover = EBIT ÷ Interest Expenses | How many times operating profit covers the interest the business pays. Not measured when there is no interest expense. |
| `cash` | Cash on Hand | Cash Flow | cur | higher is better | Cash on Hand = Closing Cash & Equivalents | Cash and bank balances at the end of the period. |
| `cf_margin` | Cash Flow Margin | Cash Flow | % | higher is better | Cash Flow Margin = Operating Cash Flow (before interest) ÷ Revenue × 100 | How much of each sale turns into operating cash. |
| `nvcf` | Net Variable Cash Flow | Cash Flow | % | higher is better | Net Variable Cash Flow = (Ann. Revenue − Ann. Variable COS − Ann. Variable Expenses − Operating Working Capital) ÷ Ann. Revenue × 100 | Cash generated by sales after variable costs and the working capital they need. |
| `rev_growth` | Revenue Growth | Growth | % | higher is better | Revenue Growth = (Revenue − Prior Revenue) ÷ Prior Revenue × 100 | Change in revenue against the prior period. |
| `gp_growth` | Gross Profit Growth | Growth | % | higher is better | Gross Profit Growth = (Gross Profit − Prior Gross Profit) ÷ Prior Gross Profit × 100 | Change in gross profit against the prior period. |
| `ebit_growth` | EBIT Growth | Growth | % | higher is better | EBIT Growth = (EBIT − Prior EBIT) ÷ \|Prior EBIT\| × 100 | Change in operating profit against the prior period. |
| `asset_change` | Asset Change | Growth | % | higher is better | Asset Change = (Total Assets − Opening Total Assets) ÷ Opening Total Assets × 100 | Growth in the asset base over the period. |
| `equity_change` | Equity Change | Growth | % | higher is better | Equity Change = (Total Equity − Opening Total Equity) ÷ Opening Total Equity × 100 | Growth in owners' equity over the period. Not measured when opening equity is zero or negative. |
| `ebitda_margin` | EBITDA Margin | Profitability | % | higher is better | EBITDA Margin = EBITDA ÷ Revenue × 100 | Operating profit before depreciation and amortisation, as a share of revenue. |
| `exp_ratio` | Expense-to-Revenue Ratio | Profitability | % | lower is better | Expense-to-Revenue Ratio = Expenses ÷ Revenue × 100 | Operating expenses as a share of revenue. |
| `mos` | Breakeven Margin of Safety | Profitability | % | higher is better | Margin of Safety = (Revenue − Breakeven Revenue) ÷ Revenue × 100 | How far revenue can fall before the business makes an operating loss. |
| `ccc` | Cash Conversion Cycle | Activity | days | lower is better | Cash Conversion Cycle = AR Days + Inventory Days + Work-in-Progress Days − AP Days | Days the business funds its own trading cycle before cash comes back. |
| `debt_equity` | Debt to Equity | Gearing | % | lower is better | Debt to Equity = Total Debt ÷ Total Equity × 100 | Borrowing relative to owners' capital. Not measured when equity is zero or negative: the company owes more than it owns. |
