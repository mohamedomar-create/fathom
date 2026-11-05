# Source adapters

Every source has its own reader; the engine never depends on one. Recognition is by headings and content, never by file
name alone, and the person confirms what each sheet is.

| Source | Reader | What it gives |
|---|---|---|
| Odoo accounting reports (GL, Trial Balance, P&L, Balance Sheet, Journal Items) | `src/lib/ingest/odoo.ts` | Balances by account and month; ledger lines for sales, expenses, stock postings, payments |
| Odoo Aged Receivable / Payable, payments list | `ingest/aged.ts`, `ingest/payments.ts` | Open items by partner; payments |
| Odoo stock exports (valuation layers, move lines, on hand, products) | `ingest/odoo-templates.ts`, `ingest/inventory.ts` | Stock |
| Odoo live (JSON-RPC, read-only) | `src/lib/odoo/*` | The same, synced nightly |
| Odoo reports recognised and skipped on purpose | `ingest/odoo-reports.ts` | Named back to the person (cash flow, partner ledger, tax, depreciation schedule, bank reconciliation, deferrals…) |
| iReport templates (P&L, balance sheet, sales, expenses, opening balances, journal items) | `src/lib/templates/spec.ts` | For any other ERP or a manual sheet |
| Generic statements and ledgers | `ingest/layout-profile.ts`, `hierarchy.ts`, `classify.ts` | Any statement layout, English or Arabic |
| Cash book | `ingest/cashbook.ts`, `src/lib/cash/read.ts` | Entries, headings by meaning, totals checked by the sheet's formulas |
| Bank statement | `ingest/bank.ts` | Lines checked by running balance |
| PDF or scan | `ingest/pdf.ts` (AI reads, figures checked) | Statements |

Not built yet: QuickBooks, Xero, Zoho, Daftra, Edara, Wafeq, SAP Business One, Dynamics 365 Business Central, NetSuite,
ERPNext. Each will be a separate adapter onto the same canonical shapes (reference §16: SAP S/4HANA and Business One,
Business Central and Finance, NetSuite and Fusion are different schemas).
