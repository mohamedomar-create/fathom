# Data quality rules

Every rule is block (stops the save unless accepted with a reason), warn (shown, never silent) or info. All money ties
use one tolerance: 1 unit of the currency (`src/lib/tolerance.ts`).

| Layer | Examples | Severity | Where |
|---|---|---|---|
| L1 File | Unreadable or wrong file type, hidden or copied sheets, header not on row 1, merged cells, numbers as text, formula errors, totals rows, mixed column types, more than one currency | block / warn / info | `src/lib/preflight` |
| L1 File's own totals | Totals in the file equal what was read | block | `ingest/*`, `company/checks.ts` |
| L2 Accounting identities | Debits = credits; assets = liabilities + equity; account roll-forward | block | `company/checks.ts` |
| L3 Continuity | Opening balance equals the stored closing; overlapping months unchanged unless replaced | block / warn | `company/import-plan.ts` |
| L4 Across modules | Sales lines tie to revenue, expenses to costs, stock to stock accounts, payments to cash movement | warn, never silent | `company/ledger-tie.ts`, `engine/tieout.ts` |
| L5 Accountant's review | Signs by nature, suspense balances, margin swings, debtor and creditor days that can't be right, interim accounts | warn with a question | review checks |

Accepted findings keep who, when and the reason. A closed month can't change (0043).
