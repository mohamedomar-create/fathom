# Canonical data model

Readers turn each source into these shapes; the engine reads only these, never a vendor's column names (reference
§6.3, §9). Known exceptions still to remove are listed at the end.

| Entity | Stored as | Grain | Notes |
|---|---|---|---|
| Account and balance | `source_accounts`, `account_balances` (0001, versioned) | account × month | Class from the account map (30 classes, sub-classes 0042). P&L = movement for the month, balance sheet = closing balance |
| Sales line | `sales_lines` (0008, 0021, 0029) | document line × month | Net of VAT; credit notes negative; `source` ledger or file; end user for agency sales |
| Expense line | `expense_lines` (0009, 0022) | document line × month | Class from the account map at query time |
| Payment | `payment_lines` (0027/0028) | payment | Company currency; kind from the counter-account |
| Aged open items | `aged_reports`, `aged_items` (0027) | partner × document at an as-of date | Pre-bucketed today; see "to change" |
| Stock | `stock_layers`, `stock_moves`, `stock_onhand`, products (0012–0015, 0045) | layer / move line / product × location | Keyed by source record id |
| Cash entry | `cash_entries` (0037) | entry | Kind (sale, expense, capital…) |
| Budget, plan | `budget_*` (0052/0053), `business_plans` (0054) | account × month; plan document | Always labelled budget or plan, never mixed with actuals |
| Import | `imports`, `import_jobs`, `import_files`, `import_rows` (0005, 0014) | file / job / staged row | State: preparing → queued → checking → needs_review / saving → done / failed / cancelled |

## Signs and units
Amounts are in the company currency. Revenue and other credits positive on the P&L, costs positive as costs; balance
sheet natural signs per class. Quantities in the product's unit of measure; different units are never added (0045).

## To change (tracked in `docs/roadmap.md`)
- An open-items entity (invoice or bill, due date, allocations) so aging is computed from source records, not taken
  pre-bucketed from one ERP's report; Odoo bucket names move into its adapter.
- Lineage on stored rows: import job, file hash, sheet and row, mapping version.
- A currency column on lines and one exchange-rate rule.
