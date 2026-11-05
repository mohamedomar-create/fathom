# Roadmap and status against the universal analytics reference

The contract is `docs/erp-universal-analytics-reference.md`. This file records, with code evidence, where iReport stands
against its 22 functional domains (§3) and its 12 acceptance tests (§13), and the order the gaps are closed in. It is
updated in the same commit as any change that moves a status.

iReport is an analytics layer: it reads ledgers, statements, sub-ledgers and manual sheets; it never posts transactions.

## Acceptance tests (§13)

| # | Test | Status | Evidence | Gap / plan |
|---|---|---|---|---|
| 1 | Odoo and manual Excel give identical AR, aging, collections | Missing | Odoo aging read pre-bucketed (`ingest/aged.ts` → `engine/payments.ts`); cash-book aging separate (`lib/cash/figures.ts`) | U2: one open-items model, aging computed by the engine; equivalence fixture test |
| 2 | Re-uploading the same file never double counts | Partial | Save modes and month fingerprints (`0021`, `company/save-modes.ts`, `month-print.ts`); stock `odoo_key` (`0012`, `0020`); staged chunk digests (`0035`) | U1: whole-file hash on every import kind; cash-book "add" row fingerprints |
| 3 | Source totals reconcile; differences visible and blocking | Partial | 1-unit tolerance (`tolerance.ts`); ledger ties (`ledger-tie.ts`); blocking checks refuse saves (`settings/actions.ts`); month close (`0043`) | U1: open blocking checks mark affected KPIs; reports and PDFs carry a warning; materiality setting |
| 4 | No fabricated margin when cost is missing | Mostly met | Sales margin needs 95% cost coverage (`engine/sales.ts`); every margin KPI is not available without the costs it subtracts (`engine/kpis.ts`, `tests/unit/kpis-partial-data.test.ts`) | Valuation: EBITDA-based methods to need expenses too |
| 5 | Aging by as-of date with partial payments and credit notes | Partial | Odoo-bucketed aging with checks (`aged.test.ts`) | U2: aging from due dates and allocations at any as-of date |
| 6 | No sum across currencies without a rate rule | Partial | Foreign payment rows without company-currency amount refused (`ingest/payments.ts`); preflight keeps one currency | U1: currency on lines; monthly rate table as the one rule |
| 7 | Large files: interactive browser, visible progress | Mostly met | Web worker parse, resumable upload, background jobs, chunked staging (`lib/imports`, `0014`, `0035`, `0055`) | One shared chunked uploader for every kind |
| 8 | Bad workbooks parsed or quarantined | Partial | Preflight (`lib/preflight`): header rows, merged cells, text numbers, formulas, totals, hidden sheets | U1: hidden rows; stored quarantine set per import |
| 9 | Tenant isolation | Met | RLS everywhere; `company_can` (`0057`/`0058`); tenant guards (`0038`); `supabase/tests/*`, `e2e-auth/rls.spec.ts` | – |
| 10 | Click a KPI → formula, filters, files, mapping, records | Weak | Formula text in `KPI_DEFS`; import id on balances (`0005`); upload-time row trace (`ingest/trace.ts`) | U1: lineage on stored rows, versions, "How is this calculated?" drawer |
| 11 | Reversing a batch restores results | Partial | Version restore for financials (`0005`); batch removal for lines and payments | U1: replaced rows kept and brought back on removal |
| 12 | Unavailable, invalid, stale and zero are different states | Mostly met | `Loaded<T>` states (`company/loaded.ts`); "Needs X" texts; `null` KPIs | U1: an "invalid data" state on affected KPIs |

## Functional domains (§3)

Implemented means a working path end to end; partial means analysis only or some sub-areas; out of scope means not
started (left until the finance, sales, stock and receivables core passes the acceptance tests, per §11).

| Domain | Status | Evidence | Main gaps |
|---|---|---|---|
| FIN Finance & accounting | Partial | Balances, account map, sub-classes (`0001`, `0010`, `0017`, `0042`); statements (`engine/statements.ts`); AR/AP (`0027`/`0028`); cash and bank (`ingest/bank.ts`, `0037`); month close (`0043`); audit tables (`0025`, `0031`, `0039`) | Bank reconciliation matching, fixed-asset register, VAT return, revenue recognition, multi-currency, consolidation and intercompany |
| TRE Treasury | Partial | IAS 7 cash flow (`engine/cashflow.ts`); three-way forecast with backtest (`engine/forecast.ts`); bank readiness and stress (`engine/bank*.ts`); real profit (`engine/real-profit.ts`) | Payment scheduling, debt schedules, daily liquidity, collection workflow |
| SAL Sales & distribution | Partial | `0008`, `ingest/sales.ts`, `engine/sales.ts`, Sales pages; Odoo sale orders | Quotes and orders analytics; profit by business line |
| CRM | Out of scope | – | All |
| PUR Procurement | Partial | Supplier spend; stock purchases from bills (`0011`); payables ageing | Purchase orders, receipts, three-way match, supplier scoring |
| INV Inventory | Implemented (analytics) | `0012`–`0015`, `0045`; `engine/inventory.ts`; Inventory pages | Serial and expiry tracking; computed valuation methods |
| SCM Supply chain | Partial | Landed cost layers in the valuation bridge | Shipments, imports, customs |
| MFG Manufacturing | Out of scope | – | All |
| QMS Quality | Out of scope | – | All |
| MNT Maintenance & assets | Out of scope | – | All |
| HRM HR | Out of scope | Salaries only as an expense type | All |
| PRJ Projects | Out of scope | – | All |
| SVC Service | Out of scope | – | All |
| RNT Rental | Partial | Rental moves, on-rent vs idle, utilisation (`0045`) | Contracts, recurring billing |
| MKT Marketing | Out of scope | – | All |
| RET Retail / POS | Out of scope (cash book only) | Cash book (`0037`, `0048`) | POS and web store sources |
| DOC Documents & workflow | Partial | Reports, share links, server PDFs; budget approval (`0052`) | General approvals, document store |
| BI Analytics | Implemented | KPIs, explorer, budget vs actual (`0052`), rollups (`0032`), AI commentary, system doctor (`0056`), portfolio | Scorecard builder |
| GRC Governance | Implemented | RLS, roles per company (`0057`/`0058`), two-step sign-in, period lock, audit | Segregation-of-duties rules |
| IT Integrations | Partial | Odoo JSON-RPC with nightly sync (`lib/odoo`, `0046`); import pipeline; preflight; exports | Other connectors as adapters |
| HCD Healthcare overlay | Implemented (narrow) | End-user hospitals (`0029`), agency statement (`0030`) | Installed base, tenders, service contracts |
| STR Strategy | Implemented | Business plan (`engine/plan.ts`, `0054`); company value (`engine/valuation`) | Profit by business unit |

## Order of work

- **Track A, standards:** U0 this documentation → U1 the failing acceptance tests (lineage, duplicates, rollback,
  partial data, invalid state, currency, quarantine; migration 0059) → U2 one open-items model with engine aging and an
  Odoo-vs-Excel equivalence test (migration 0060).
- **Track B, company value:** V2 value drivers, value plan, exit readiness, ranges of outcomes, value history (0061) →
  V3 memo, PDF and Excel.
- **Then:** the owner's roadmap with finance, sales, stock and receivables correctness first; other ERPs as separate
  adapters; Purchasing, Rental and CRM basics after.
