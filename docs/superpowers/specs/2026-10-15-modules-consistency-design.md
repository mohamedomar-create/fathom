# Operational modules and the consistency layer: design

Status: draft for review · 2026-10-15 · Scope: M-0 (consistency layer) and M-1 (Inventory) in full; M-2 Payments, M-3 Rental and M-4 Purchasing as outlines, each to get its own spec before it is built.

## 1. Goal

Four new modules (Inventory, Purchasing, Rental, Payments) built the way Sales and Expenses are: an executive page, charts, tables and rule-based findings, fed by one or several Odoo sheets per upload, and later by the live Odoo connection.

Two rules are not negotiable:

1. **No duplicated or confusing records.** A record is stored once, in the one module that owns it. Uploading the same records again never adds them twice.
2. **Every module agrees with the accounts.** Each month, every module's figures are checked against the General Ledger accounts they belong to (for example: cost of sales in the GL = the cost of goods delivered from stock). A difference is shown with its cause; nothing is adjusted to make it match.

## 2. What the company's Odoo does (from the owner's answers)

| Setting | Value | Consequence |
|---|---|---|
| Version | Odoo 18 | Sheet layouts and column names follow Odoo 18. |
| Inventory valuation | Automated (real time) | Every receipt, delivery, adjustment and landed cost posts its own journal entry: stock and cost of sales can be matched to the GL exactly, per month and per entry. |
| Costing | FIFO | Each outgoing move carries the value of the layers it consumed. iReport reads Odoo's valuation layers; it never recomputes cost. |
| Purchases | Foreign currency (USD, EUR) and Odoo Landed Costs | Purchase lines keep currency and rate; landed costs are valuation layers of their own and are part of stock value. |
| Rental | Rented items are storable products kept in stock | Pickups and returns are stock moves to and from a rental location; they change where items are, not their value. |
| Data | Excel exports now, live connection later | One set of rules for both. |

## 3. M-0: the consistency layer

### 3.1 The General Ledger is the master for money

Modules add detail the ledger does not hold (quantities, products, locations, orders, schedules, partners, statuses). A module never becomes a second source of an amount that is already in the ledger; where both hold an amount, the module's figure is compared with the ledger's and the difference is reported.

### 3.2 One owner per record type

| Record (Odoo model) | Owner | Read by |
|---|---|---|
| Journal items (`account.move.line`) | Financials (exists) | every module, for tie-outs |
| Customer invoice lines | Sales (exists) | Rental (rental revenue only) |
| Vendor bill lines | Expenses (exists) | Purchasing (billed amounts) |
| Valuation layers (`stock.valuation.layer`), incl. landed costs | Inventory | Purchasing, Rental |
| Done move lines (`stock.move.line`) | Inventory | Purchasing (receipts), Rental (pickups, returns) |
| Stock on hand (`stock.quant`) | Inventory | none |
| Purchase order lines (`purchase.order.line`) | Purchasing | none |
| Rental order lines and schedule | Rental | none |
| Payments, bank statement lines, cheques | Payments | none |

A module reads another module's records through that module's summary; it never stores its own copy.

### 3.3 Sheet routing

The sheet-role step (`src/lib/ingest/roles.ts`, shown in `src/components/upload/sheet-roles.tsx`) gains one role per new sheet type: `stock_valuation`, `stock_moves`, `stock_onhand`, `products` (Inventory); later `purchase_lines`, `rental_lines`, `payments`, `bank_lines`, `cheques`. Each role is recognised from its columns (Section 4.1), says why, and can be changed by the person, as today. A sheet has exactly one role, so it feeds exactly one module.

### 3.4 Record keys and duplicates

- The Odoo export dialog's **"I want to update data (import-compatible export)"** adds an `ID` column (Odoo's external ID, for example `__export__.stock_valuation_layer_1234_5a6b7c`). It is stored as `odoo_id`. Each line table has a unique key on `(company_id, odoo_id)`.
- A sheet exported without the ID column is still accepted. Its key becomes a fingerprint of the fields that identify the record (Section 4.2), held in the same unique key, and the reading panel says that the ID column would make the check exact.
- Upload modes stay as today:
  - **Replace** removes the module's records of that sheet type for the months the file covers, then adds the file's records.
  - **Add only new** adds records whose key is not yet stored and counts the rest as "already here" (no change).
  - **The same file again under Replace** removes every record of the earlier uploads of that file first (the rule added in 700cc27).
- All writes go through all-or-nothing database functions (`begin_*_batch`, `add_*_lines`), as Sales and Expenses do.

### 3.5 Tie-outs

A shared engine file `src/lib/engine/tieout.ts` defines one shape used by every module:

```ts
interface TieOut {
  key: string;            // "stock_value", "cogs", …
  period: string;         // "2026-09"
  module: number;         // the module's figure
  ledger: number | null;  // null when the ledger is not loaded for that month
  diff: number | null;    // module − ledger
  status: "ok" | "off" | "no_ledger";  // off when |diff| > 1 (one pound)
  causes: { ref: string; amount: number; why: string }[]; // the records behind a difference, largest first
}
```

Tie-outs run whenever the module page or Data health is opened, from the stored records and the stored ledger lines. They show on the module's overview (a banner when any month is off), on Data health, and in the module's report page later. With no General Ledger loaded, the module still works and every tie-out reads "needs the General Ledger".

## 4. M-1: Inventory

### 4.1 Sheets (Odoo 18), one or several per upload

| Role | Odoo menu | Columns read (English or Arabic headings) | Recognised by |
|---|---|---|---|
| `stock_valuation` | Inventory ▸ Reporting ▸ Valuation (list, export) | ID, Date, Reference, Product (and internal reference), Lot/Serial, Quantity, Unit of Measure, Unit Value, Total Value, Description, Landed Cost (if shown) | Product + Quantity + Total Value, and Reference or Description |
| `stock_moves` | Inventory ▸ Reporting ▸ Moves History (done move lines) | ID, Date, Reference, Product, Lot/Serial, From, To, Quantity, Unit of Measure, Status, Partner (if shown) | Product + From + To + Quantity |
| `stock_onhand` | Inventory ▸ Reporting ▸ Stock | Location, Product, Lot/Serial, On Hand Quantity, Unit of Measure, Value | Location + Product + quantity, no dates |
| `products` (optional) | Inventory ▸ Products (list, export) | Internal Reference, Name, Product Category, Cost, Product Type | Product + Category, no quantities by date |

Exact column names are confirmed on the owner's first sample export before the readers are finished; the readers accept both the Odoo 18 English labels and the Arabic labels Odoo uses.

### 4.2 Storage (new migration `0012_inventory.sql`)

- `inventory_batches`: as `sales_batches`, plus `kind text check (kind in ('valuation','moves','onhand','products'))`.
- `stock_layers`: `company_id, batch_id, odoo_id, day, period, ref, layer_kind, product, product_code, category, lot, qty numeric(18,4), unit_value numeric(18,4), value numeric(18,2), partner, landed_ref`.
  - `layer_kind` is one of `receipt, delivery, customer_return, supplier_return, landed_cost, adjustment, scrap, revaluation, other`, decided from the reference and the matching move (Section 4.3).
  - Fingerprint when there is no ID: `day | ref | product | lot | qty | value`.
- `stock_moves`: `company_id, batch_id, odoo_id, day, period, ref, product, product_code, lot, from_loc, to_loc, qty, uom, partner, move_kind`.
  - `move_kind` is one of `receipt, delivery, customer_return, supplier_return, internal, rental_out, rental_back, adjustment, scrap, manufacturing`.
  - Fingerprint: `day | ref | product | lot | from | to | qty`.
- `stock_onhand`: `company_id, batch_id, as_of date, product, product_code, location, lot, qty, value`, unique on `(company_id, as_of, product, location, lot)`.
  - It is a snapshot: a new upload for the same date replaces it.
- `inventory_products`: `company_id, code, name, category, cost, type`, unique on `(company_id, code)`.
  - Kept as the latest list.
- RLS as in `0008_sales.sql`: members read, editors write; the save functions are the normal path.
- Functions: `begin_inventory_batch`, `add_stock_layers`, `add_stock_moves`, `set_stock_onhand`, `inventory_summary(company)`.
  - The summary returns monthly totals per product, kind and location, so pages never load every row.

### 4.3 Reading rules

- **Move kind from locations**, using Odoo's location types:
  - Partners/Vendors → stock: receipt;
  - stock → Partners/Customers: delivery;
  - Customers → stock: customer return;
  - stock → Vendors: supplier return;
  - Virtual/Inventory adjustment: adjustment;
  - Virtual/Scrap: scrap;
  - Virtual/Production: manufacturing;
  - stock → stock: internal.
- **Rental location**: a location whose name contains "Rental", "تأجير" or "إيجار", or the one the person picks once in Settings. Moves to it are `rental_out`; moves back from it are `rental_back`.
- **Layer kind**: from the matching move when both sheets are loaded (same reference and product); otherwise from the reference prefix (`/IN/`, `/OUT/`, `/RET`) and the sign of the quantity.
  - Landed costs: layers whose description starts "Landed cost" or which name an `LC/` document.
- **Value sign**: incoming layers are positive, outgoing negative, as Odoo stores them.
  - Value is in the company currency (EGP); no currency conversion is done for stock.
- **Partial months** follow the rules already used for the accounts (part month labelled, never extrapolated).

### 4.4 Tie-outs (per month)

| Key | Module side | Ledger side | Notes |
|---|---|---|---|
| `stock_value` | Closing value: sum of all layers up to the month end | Closing balance of accounts mapped to class `inventory` | The strongest check: every valued movement shows here. |
| `stock_movement` | Sum of the month's layers | Change in the `inventory` accounts' balance over the month | Same check, month by month, so a difference points to its month. |
| `cogs` | − sum of `delivery` layers + `customer_return` layers in the month | Cost-of-sales lines posted by stock moves (the ledger lines grouped today as "Cost of goods sold (stock)") | Equal by construction under automated valuation. |
| `receipts` | Sum of `receipt` + `landed_cost` − `supplier_return` layers | Debits to the stock accounts from receipts and landed costs (stock-interim side) | Feeds Purchasing's received-not-billed check later. |
| `qty_onhand` | Stock on hand per product at its date | Opening quantity + done moves up to that date | Inside the module only; points to missing move uploads. |
| `rental_value` | Value of layers on `rental_out` / `rental_back` moves | 0 | A non-zero value means a rental move was valued; it is flagged. |

`causes` lists the references (WH/OUT/0123, LC/2026/0004…) whose module amount has no matching ledger amount or the other way round, largest first, so the person can fix the source in Odoo.

### 4.5 Engine (`src/lib/engine/inventory.ts`)

`inventoryAnalysis(data, sel, opts)` takes the summary rows, the selected period and options. The options are `{ lang, ledger: { stock, stockMove, cogs, receipts } per period, revenue per period }`. It returns:

- headline: stock value, the change and the main driver;
- tiles: stock value, stock days (closing value ÷ cost of sales per day), cost of sales, slow stock value (no outgoing move in 90 days), and dead stock value (180 days);
- the value bridge for the period: opening + receipts + landed costs − deliveries + returns ± adjustments and scrap ± revaluation = closing (it must close to the cent);
- products table: value, quantity, days on hand, turnover, ABC class (by cost of sales), last movement, slow or dead flag;
- movements by month and kind, and by warehouse or location;
- valuation: FIFO layers per product, landed costs per receipt, and unit cost trend;
- tie-outs (Section 4.4);
- findings (rule-based, bilingual through `lang` as in the Sales and Expenses engines):
  - stock growing faster than sales over 3 months;
  - slow and dead stock above 10% of stock value;
  - negative quantity on hand;
  - adjustments and scrap above 1% of cost of sales;
  - receipts with no landed cost while landed costs are used on other receipts of the same supplier;
  - any tie-out off.

### 4.6 Pages (sector "Inventory" in the side menu, same look as Sales and Expenses)

- **Overview** (`/company/[id]/inventory`):
  - headline, tiles and tie-out banner;
  - value bridge chart and monthly stock value against cost of sales;
  - top products by value;
  - findings.
- **Products** (`/inventory/products`): the products table with ABC, slow and dead filters and a category breakdown.
- **Movements** (`/inventory/movements`): monthly receipts, deliveries, returns, internal, rental, adjustments and scrap; the locations table.
- **Valuation** (`/inventory/valuation`): layers and landed costs, unit cost trend per product, and the tie-out table month by month with causes.
- Readiness card for the sector "inventory" (what is loaded, which tie-outs pass).
- Demo company: a generated stock history (`src/lib/company/demo-inventory.ts`). Its cost of sales and stock balance equal the demo accounts exactly, so the demo shows every tie-out green.

### 4.7 Upload wizard

- A fourth card, "Inventory", in Data setup and the wizard, with the four sheet types and short Odoo export steps for each (with "import-compatible export" ticked).
- Several Inventory sheets in one workbook or several files are read together.
- The reading panel shows, per sheet:
  - the role and why;
  - records found, new, and already here;
  - months covered;
  - the tie-outs that the upload changed.

### 4.8 Live Odoo connection (after the export path works)

`src/lib/odoo/sync.ts` reads `stock.valuation.layer`, `stock.move.line` (state done) and `stock.quant` with the same field set and produces the same rows, keyed by Odoo's database ID. The tie-outs and duplicate rules are the same.

## 5. Outlines of the later modules (each gets its own spec)

### M-4 Purchasing

- **Sheets:** purchase order lines (order, date, supplier, product, ordered, received and billed quantities, unit price, currency, rate, status).
- **Reads:** receipts from Inventory, vendor bills from Expenses.
- **Tie-outs:**
  - received-not-billed (value) = the stock interim / goods-received-not-invoiced balance;
  - billed (company currency) = vendor bill lines in Expenses for those orders;
  - received value = Inventory receipt layers.
- **Pages:** supplier performance (on-time, lead time, price change), open commitments, currency exposure.

### M-3 Rental

- **Sheets:** rental order lines and schedule (order, customer, product, lot or serial, pickup and return dates, planned and actual, status).
- **Reads:** rental moves from Inventory, rental revenue lines from Sales.
- **Tie-outs:**
  - pickups and returns = Inventory `rental_out` / `rental_back` moves;
  - rental revenue shown = rental lines already in Sales (never stored twice);
  - Sales = the rental revenue account.
- **Pages:** utilisation per item, on rent versus idle, late returns, revenue per item and per customer.

### M-2 Payments

- **Sheets:** payments (date, journal, partner, amount, inbound or outbound, reconciled invoices or bills), bank statement lines, cheques (received and issued, due date, status), aged receivables and payables.
- **Tie-outs:**
  - payments and statement lines per bank or cash journal = the ledger movement on that journal's account;
  - customer collections = the decrease in receivables from payments;
  - supplier payments = the decrease in payables;
  - owner's current account, capital injections, loans and investments = the movement on those balance-sheet accounts;
  - CPS, company cards and bank charges follow the rules in `src/lib/ingest/expenses.ts`.
- **Pages:** cash in and out, collections and overdue customers, payables due, cheques due and bounced, owner and financing flows.

## 6. Build order

1. M-0 tie-out engine and storage pattern, with Inventory as its first user.
2. M-1 Inventory: readers, migration, save functions, engine, pages, wizard card, demo, tests. Proven on a real sample before it is called done.
3. M-4 Purchasing (reuses Inventory receipts).
4. M-3 Rental (reuses Inventory rental moves).
5. M-2 Payments.
6. The live Odoo connection for each module, after its export path works.

## 7. Testing

- **Unit (engine and readers)**, using made-up FIFO data:
  - two receipts at different prices, a landed cost, a partial delivery, a customer return, a rental pickup and return, a scrap, and a duplicate upload.
  - Expected:
    - the layers sum to the ledger stock balance;
    - delivery layers equal cost of sales;
    - the bridge closes to the cent;
    - the rental moves have value 0;
    - the duplicate upload adds 0 rows;
    - a removed layer shows as an `off` tie-out naming its reference.
- **Readers:** Odoo 18 English and Arabic headings, with and without the ID column.
- **Database:** the unique keys refuse a second copy; Replace and Add-only-new behave as in Section 3.4; the save is all-or-nothing.
- **Browser:**
  - the wizard routes each Inventory sheet to Inventory only;
  - the same file twice changes nothing;
  - the demo shows every tie-out green;
  - signed-in upload and replace work.
- **Real file:** on the owner's sample, every tie-out is 0 or explained record by record.

## 8. Not in scope for M-1

Manufacturing cost analysis beyond counting manufacturing moves; demand forecasting and reorder points; multi-company consolidation; Arabic for the new pages (follows the Arabic programme after step 4).
