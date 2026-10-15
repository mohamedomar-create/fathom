# Inventory module and tie-out layer: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Inventory module (Odoo 18 valuation layers, done moves, stock on hand, products) on top of a shared tie-out layer that checks every module against the General Ledger month by month, with no duplicate records.

**Architecture:**
- **Same pattern as Sales and Expenses:**
  - readers in `src/lib/ingest/`;
  - batch and line tables with all-or-nothing save functions and a summary function in a migration;
  - server actions plus a chunked client saver;
  - a summary loaded into a React context;
  - a pure engine in `src/lib/engine/`;
  - pages under `/company/[id]/inventory` and `/demo/inventory`.
- **Tie-outs** are a small shared engine (`tieout.ts`). The ledger side comes from data already stored:
  - stock balance: the `inventory` class in the months' balance sheets;
  - cost of sales from stock: the "Cost of goods sold (stock)" expense lines;
  - stock postings by reference: a new ledger-lines kind, "stock".

**Tech Stack:** Next.js 16 app router, TypeScript, Supabase Postgres (RLS, security-definer functions), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-15-modules-consistency-design.md`

**Not in this plan:** the live Odoo connection for Inventory (spec §4.8). It follows once the export path is proven on a real file (spec §6, step 6).

## Global Constraints

- The General Ledger is the master for money; modules never store a second copy of a ledger amount. A difference is reported, never adjusted.
- Record key: Odoo's external ID from "I want to update data (import-compatible export)", stored as `odoo_id`. Without it, a fingerprint, held in the same unique key `(company_id, odoo_key)`.
  - Layers: `day|ref|product|lot|qty|value`.
  - Moves: `day|ref|product|lot|from|to|qty`.
- Tie-out status: `off` when `|module − ledger| > 1` (one pound); `no_ledger` when the ledger month is missing; else `ok`.
- Upload modes: `replace` (this kind's records for the file's months), `add` (new keys only; the rest counted as "already here"), and the same file under Replace removes all earlier uploads of that file (as `dropEmpty`/`sameFile` in `src/app/company/[id]/settings/sales-actions.ts`).
- Values in the company currency (EGP); FIFO values are read from Odoo, never recomputed. Incoming layers positive, outgoing negative.
- Rental location: a location name matching `/rental|تأجير|إيجار/i`, or the one picked in settings. Rental moves must carry value 0.
- English text stays the engine's language; new UI words go in an i18n area with Arabic filled (the dictionary completeness test requires it); Arabic polish of these pages stays on hold.
- The repo is public: no real company data in fixtures. The live database migration is pasted by the owner (the session's write connection times out).

## Review Focus

1. **The same rows in a second file with a different name** (an export re-done the next day): expected 0 new rows, "N already here", no change in any total. → Task 5, test `addModeCountsAlreadyHere`.
2. **Moves sheet uploaded without the valuation sheet:** expected quantities and movements pages work, value tiles read "needs the valuation export", and tie-outs read "needs the valuation export", not `off`. → Task 7, test `movesOnlyGivesQuantitiesAndNoValueTieOuts`.
3. **A month in the module with no General Ledger month:** expected status `no_ledger`, never `off`. → Task 1, test `missingLedgerMonthIsNoLedger`.
4. **Thousands of layers (a year of a busy warehouse, ~200k rows):** expected a chunked save that completes, and pages that read the monthly summary, not raw rows. → Task 5, test `savesInChunksOf3000`; Task 4 summary returns aggregates only.
5. **Arabic Odoo headings and Arabic product or location names:** expected to read the same as English, and the rental location recognised by "تأجير". → Task 2, test `readsArabicHeadingsAndRentalLocation`.

---

### Task 1: Shared tie-out engine

**Files:**
- Create: `src/lib/engine/tieout.ts`
- Modify: `src/lib/engine/index.ts` (export it)
- Test: `tests/unit/tieout.test.ts`

**Interfaces:**
- Produces:
  - `type TieStatus = "ok" | "off" | "no_ledger"`
  - `interface TieCause { ref: string; module: number; ledger: number; why: "module_only" | "ledger_only" | "amount_differs" }`
  - `interface TieOut { key: string; period: string; module: number; ledger: number | null; diff: number | null; status: TieStatus; causes: TieCause[] }`
  - `tieOut(key: string, period: string, module: number, ledger: number | null, byRef?: { module: Record<string, number>; ledger: Record<string, number> }): TieOut`
    - Causes are listed only when the status is `off`, largest absolute gap first, at most 20.
  - `tieOutSeries(key: string, periods: string[], module: Record<string, number>, ledger: Record<string, number> | null, byRef?: (p: string) => { module: Record<string, number>; ledger: Record<string, number> }): TieOut[]`
  - `const TIE_TOLERANCE = 1`

- [ ] **Step 1: Write the failing tests**
  - `exactMatchIsOk`: `tieOut("cogs","2026-09",1000,1000).status === "ok"`, with `diff === 0`.
  - `withinOnePoundIsOk`: module 1000.6 against ledger 1000 gives `ok`.
  - `overOnePoundIsOffWithCauses`: module 1500 against ledger 1000, byRef `{module:{"WH/OUT/1":1000,"WH/OUT/2":500}, ledger:{"WH/OUT/1":1000}}`.
    - Expect `off`, `diff === 500`, and `causes[0]` equal to `{ref:"WH/OUT/2", module:500, ledger:0, why:"module_only"}`.
  - `missingLedgerMonthIsNoLedger`: `tieOut(..., 1000, null).status === "no_ledger"`, with `diff === null`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/tieout.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the interfaces above in `src/lib/engine/tieout.ts`. Round diffs to 2 decimals.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with message `Tie-outs: one shared check of a module against the ledger, with the records behind a difference`.

### Task 2: Inventory sheet readers

**Files:**
- Create: `src/lib/ingest/inventory.ts`
- Test: `tests/unit/inventory-read.test.ts` (grids built in the test, made-up products)

**Interfaces:**
- Consumes: `Grid`, `str` from `src/lib/ingest/extract.ts`; `arRx`, `normAr` from `src/lib/ingest/parse.ts`; the date and number cell helpers the sales reader uses (`src/lib/ingest/sales.ts`).
- Produces:
  - Types:
    - `type MoveKind = "receipt" | "delivery" | "customer_return" | "supplier_return" | "internal" | "rental_out" | "rental_back" | "adjustment" | "scrap" | "manufacturing"`
    - `type LayerKind = "receipt" | "delivery" | "customer_return" | "supplier_return" | "landed_cost" | "adjustment" | "scrap" | "revaluation" | "other"`
  - Row interfaces. `key` is the odoo_id or `"fp:" + fingerprint`; `src` is the sheet/row trace kept in the browser, as in `ExpenseLine`.
    - `interface StockLayer { key: string; day: string; period: string; ref: string; kind: LayerKind; product: string; code: string; category: string; lot: string; qty: number; unitValue: number; value: number; partner: string; landedRef: string; src?: unknown }`
    - `interface StockMove { key: string; day: string; period: string; ref: string; kind: MoveKind; product: string; code: string; lot: string; from: string; to: string; qty: number; uom: string; partner: string; src?: unknown }`
    - `interface OnHand { asOf: string; product: string; code: string; location: string; lot: string; qty: number; value: number | null }`
    - `interface ProductRow { code: string; name: string; category: string; cost: number | null; type: string }`
  - Readers, each returning null when the grid is not that sheet:
    - `readStockValuation(g: Grid): { layers: StockLayer[]; withIds: boolean } | null`
    - `readStockMoves(g: Grid, rentalLocation?: string | null): { moves: StockMove[]; withIds: boolean } | null`
    - `readStockOnHand(g: Grid, asOf: string): OnHand[] | null`
    - `readProducts(g: Grid): ProductRow[] | null`
  - Classifiers:
    - `moveKind(from: string, to: string, rentalLocation?: string | null): MoveKind`
    - `layerKind(ref: string, description: string, qty: number, move?: MoveKind): LayerKind`
  - `inventoryPeriods(rows: { period: string }[]): string[]`

- [ ] **Step 1: Write the failing tests**
  - `readsValuationWithIds`: a grid with headers `ID | Date | Reference | Product | Lot/Serial Number | Quantity | Unit Value | Total Value | Description`.
    - Rows:
      - `__export__.svl_1 | 2026-09-02 | WH/IN/00001 | [P1] Mask | | 10 | 100 | 1000 |`;
      - `__export__.svl_2 | 2026-09-05 | WH/OUT/00001 | [P1] Mask | | -4 | 100 | -400 |`;
      - `__export__.svl_3 | 2026-09-06 | LC/2026/0001 | [P1] Mask | | 0 | 0 | 120 | Landed cost LC/2026/0001`.
    - Expect `withIds`, keys `__export__.svl_1..3`, kinds `["receipt","delivery","landed_cost"]`, values `[1000,-400,120]`, code `P1`, product `Mask`, period `2026-09`.
  - `fingerprintsWithoutIds`: the same rows without the ID column. Expect `withIds === false` and keys starting `fp:`; the same row twice gives the same key.
  - `classifiesMovesByLocation`: `moveKind("Partners/Vendors","WH/Stock")==="receipt"`, `("WH/Stock","Partners/Customers")==="delivery"`, `("Partners/Customers","WH/Stock")==="customer_return"`, `("WH/Stock","Partners/Vendors")==="supplier_return"`, `("WH/Stock","Virtual Locations/Inventory adjustment")==="adjustment"`, `("WH/Stock","Virtual Locations/Scrap")==="scrap"`, `("WH/Stock","WH/Rental")==="rental_out"`, `("WH/Rental","WH/Stock")==="rental_back"`, `("WH/Stock","WH/Shelf 2")==="internal"`.
  - `readsArabicHeadingsAndRentalLocation`: headers `المعرف | التاريخ | المرجع | المنتج | من | إلى | الكمية | الحالة`, a row to `WH/مخزن التأجير`. Expect kind `rental_out`.
  - `readsOnHandSnapshot`: headers `Location | Product | Lot/Serial Number | On Hand Quantity | Value`. Expect rows with `asOf` passed in.
  - `rejectsOtherSheets`: a sales list grid gives `null` from all four readers.
- [ ] **Step 2: Run** `npx vitest run tests/unit/inventory-read.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `src/lib/ingest/inventory.ts`.
  - Header matching uses `arRx`, like the sales reader.
  - The product's `[CODE] Name` is split into code and name.
  - Only done moves are kept (Status column "Done"/"منتهي" when present).
  - Rental location: the explicit argument, else the regex in Global Constraints.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** with message `Inventory: read Odoo valuation, moves, stock on hand and products sheets`.

### Task 3: Stock postings from the General Ledger

**Files:**
- Modify: `src/lib/ingest/inventory.ts` (add `stockFromLedger`)
- Modify: `src/lib/odoo/sync.ts:212` (return `stock: stockFromLedger(lines)` too)
- Test: `tests/unit/inventory-read.test.ts`

**Interfaces:**
- Consumes: the ledger account shape that `expensesFromLedger` takes (`{ code; name; cls; excluded; system?; entries?: LedgerEntry[] }[]`).
- Produces:
  - `interface StockLedgerLine { day: string; period: string; ref: string; account: string; amount: number }`, where the amount is the debit minus credit on an `inventory`-class account.
  - `stockFromLedger(lines): StockLedgerLine[]`

- [ ] **Step 1: Failing test `stockLedgerKeepsInventoryAccountsOnly`.** A GL with:
  - an `inventory` account holding `WH/IN/00001 +1000`, `WH/OUT/00001 −400` and `LC/2026/0001 +120`;
  - an `exp_fixed` account.
  - Expect three lines with those refs and amounts, and nothing from the expense account.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.** Skip `excluded` and `system` accounts.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** with message `Inventory: stock postings by reference from the General Ledger`.

### Task 4: Database: inventory tables, keys and save functions

**Files:**
- Create: `supabase/migrations/0012_inventory.sql`
- Create: `tests/sql/inventory_keys.sql` (run by CI the way `tests/sql/rls_isolation.sql` is)
- Modify: `.github/workflows/ci.yml` (run the new SQL test next to the existing one)

**Interfaces (SQL):**
- Tables, all with `company_id` and RLS as in `0008_sales.sql`:
  - `inventory_batches(id, company_id, kind check in ('valuation','moves','onhand','products'), filename, periods text[], mode check in ('replace','add'), report jsonb, created_by, created_at)`
  - `stock_layers(... batch_id, odoo_key text not null, day date, period, ref, kind, product, code, category, lot, qty numeric(18,4), unit_value numeric(18,4), value numeric(18,2), partner, landed_ref)` with `unique (company_id, odoo_key)`.
  - `stock_moves(... batch_id, odoo_key, day, period, ref, kind, product, code, lot, from_loc, to_loc, qty, uom, partner)` with `unique (company_id, odoo_key)`.
  - `stock_onhand(... batch_id, as_of date, product, code, location, lot, qty, value)` with `unique (company_id, as_of, product, location, lot)`.
  - `inventory_products(company_id, code, name, category, cost, type)` with `unique (company_id, code)`.
  - `stock_ledger_batches` and `stock_ledger_lines(... batch_id, source text default 'ledger' check (source='ledger'), day, period, ref, account, amount)`, mirroring `expense_batches`/`expense_lines` so `clearLedger` can treat them as a third kind.
- Functions (security definer, `search_path = ''`, editor check through `private.is_member(private.company_org(...), 'editor')`, execute revoked from public and anon and granted to authenticated):
  - `begin_inventory_batch(p_company uuid, p_kind text, p_periods text[], p_filename text, p_mode text, p_report jsonb) returns uuid`. Under `replace` it deletes this kind's rows for `p_periods`; under `add` it deletes nothing.
  - `add_stock_layers(p_batch uuid, p_rows jsonb) returns jsonb` and `add_stock_moves(p_batch uuid, p_rows jsonb) returns jsonb`.
    - Each does `insert … on conflict (company_id, odoo_key) do nothing` and returns `{"added": n, "already": m}`.
    - Each refuses more than 5,000 rows and rows outside the batch's periods.
  - `set_stock_onhand(p_batch uuid, p_as_of date, p_rows jsonb) returns integer`: replaces that date's snapshot.
  - `set_inventory_products(p_company uuid, p_rows jsonb) returns integer`: upsert by code.
  - `inventory_summary(p_company uuid) returns jsonb` (security invoker). It returns monthly aggregates only:
    - `layers`: `{p, kind, code, product, category, q, v, n}`;
    - `moves`: `{p, kind, code, from, to, q, n}`;
    - `last_out`: `{code, day}`;
    - `onhand`: the latest snapshot per product;
    - `products`;
    - `byRef`: `{p, ref, kind, v}`, limited to refs in months where some value exists, for causes;
    - `ledger`: `{p, ref, v}` from `stock_ledger_lines`;
    - `meta`: `{withIds, kinds loaded, periods}`.

- [ ] **Step 1: Write `tests/sql/inventory_keys.sql`.** It runs as an editor of company A. Each assertion raises an exception on failure:
  - adding the same two layer rows twice returns `{"added":2,"already":0}` then `{"added":0,"already":2}`, with a final `count(*) = 2`;
  - a stranger (no membership) calling `begin_inventory_batch` gets `42501`;
  - `replace` for `{2026-09}` leaves rows of `2026-08` in place.
- [ ] **Step 2: Run it** against the local stack: `set -a; . .local-supabase/env; set +a; psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/0012_inventory.sql -f tests/sql/inventory_keys.sql`. Expected: FAIL before the migration exists.
- [ ] **Step 3: Write the migration** to the interfaces above.
- [ ] **Step 4: Re-run** the command. Expected: completes with no exception. Also run `tests/sql/rls_isolation.sql`; it must still pass.
- [ ] **Step 5: Commit** with message `Inventory: tables keyed by Odoo ID, all-or-nothing saves and the monthly summary`. Then prepare `begin`-style paste SQL (the migration file itself) for the owner to run on the live database.

### Task 5: Server actions and the chunked saver

**Files:**
- Create: `src/app/company/[id]/settings/inventory-actions.ts`
- Create: `src/lib/company/save-inventory.ts`
- Modify: `src/lib/company/ledger-lines.ts` (add `"stock"` to `LineKind`/`TABLES`; `saveLedgerLines` accepts `StockLedgerLine[]`)
- Modify: `src/lib/company/ledger-tie.ts` (the `LineKind` type)
- Modify: `src/app/company/[id]/settings/odoo-actions.ts:109-110` (also save `ls.stock` as kind `"stock"`)
- Test: `tests/unit/save-inventory.test.ts`, with the actions mocked as in the existing saver tests (if none exist, mock the module with `vi.mock`)

**Interfaces:**
- Consumes: Task 2 row types; Task 4 functions.
- Produces:
  - Actions, each validated with zod and rate-limited like `startExpenseBatch`:
    - `startInventoryBatch(input: { companyId: string; kind: "valuation" | "moves" | "onhand" | "products"; periods: string[]; filename?: string; mode: "replace" | "add"; report?: Record<string, unknown> }): Promise<{ ok: true; batch: string } | { ok: false; error: string }>`
      - Under `replace` with the same filename, it first removes earlier batches of that file and kind (same rule as `sameFile` in `sales-actions.ts`).
    - `addInventoryRows(companyId: string, batch: string, kind: "valuation" | "moves", rows: unknown[]): Promise<{ ok: true; added: number; already: number } | { ok: false; error: string }>`
    - `setOnHand(companyId: string, batch: string, asOf: string, rows: OnHand[])`
    - `setProducts(companyId: string, rows: ProductRow[])`
  - The saver: `saveInventory(companyId: string, parts: { layers?: StockLayer[]; moves?: StockMove[]; onhand?: { asOf: string; rows: OnHand[] }; products?: ProductRow[] }, filename: string, mode: "replace" | "add"): Promise<{ ok: true; added: number; already: number } | { ok: false; error: string }>`
    - Chunks of 3000. `src` is stripped before sending. Strings are cut to the column limits.

- [ ] **Step 1: Failing tests**
  - `savesInChunksOf3000`: 7,001 layers give 3 calls to `addInventoryRows`, and the result sums `added`.
  - `addModeCountsAlreadyHere`: the mocked action returns `{added:0, already:3000}`, and the saver reports `already: 3000, added: 0`.
  - `stripsTraceAndCutsStrings`: a product of 400 characters is sent cut to 300, with no `src` key.
- [ ] **Step 2: Run** `npx vitest run tests/unit/save-inventory.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the actions and saver; extend `ledger-lines.ts` with the `"stock"` kind.
- [ ] **Step 4: Run** the tests plus `npx vitest run tests/unit` (no regressions in the ledger-lines tests). Expected: PASS.
- [ ] **Step 5: Commit** with message `Inventory: save actions with replace / add-only-new and Odoo-ID duplicates refused`.

### Task 6: Summary loading and context

**Files:**
- Create: `src/lib/company/inventory-parse.ts`, `src/lib/company/inventory-load.ts`, `src/lib/company/inventory-context.tsx`
- Modify: `src/lib/engine/inventory.ts` (types only, at this step)
- Test: `tests/unit/inventory-parse.test.ts`

**Interfaces:**
- Produces:
  - `interface InventoryData { layers: LayerRow[]; moves: MoveRow[]; lastOut: Record<string, string>; onhand: OnHand[]; products: ProductRow[]; byRef: { p: string; ref: string; kind: LayerKind; v: number }[]; ledger: { p: string; ref: string; v: number }[]; meta: { withIds: boolean; kinds: string[]; periods: string[] } }`
    - `LayerRow` and `MoveRow` mirror the summary's JSON fields.
  - `EMPTY_INVENTORY: InventoryData`
  - `parseInventorySummary(raw: unknown): InventoryData`: tolerant of missing keys, numbers coerced, as `parseExpenseSummary` does.
  - `loadInventory = cache(async (companyId: string): Promise<InventoryData>)`, which calls `inventory_summary`. A missing function (`PGRST202`) returns `EMPTY_INVENTORY`.
  - `InventoryProvider`, `useInventory()`, the same pattern as `expenses-context.tsx`.

- [ ] **Step 1: Failing test `parsesSummaryAndToleratesMissingKeys`.**
  - `parseInventorySummary({layers:[{p:"2026-09",kind:"receipt",code:"P1",product:"Mask",category:"",q:"10",v:"1000",n:1}]})` gives `layers[0].v === 1000`, and `moves` is `[]`.
  - `parseInventorySummary(null)` deep-equals `EMPTY_INVENTORY`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** with message `Inventory: load the monthly summary into the pages`.

### Task 7: Inventory engine

**Files:**
- Modify: `src/lib/engine/inventory.ts`
- Modify: `src/lib/engine/index.ts`
- Test: `tests/unit/inventory.test.ts`

**Interfaces:**
- Consumes: `InventoryData` (Task 6); `tieOutSeries` (Task 1); `Selection` and `periodsFor` as used by `expensesAnalysis` in `src/lib/engine/expenses.ts`.
- Produces: `inventoryAnalysis(d: InventoryData, sel: Selection, opts: { ledger: { stock: Record<string, number> | null; cogs: Record<string, number> | null }; lang?: "en" | "ar"; today?: string }): InventoryAnalysis`
  - The returned value:
    - `{ hasValue: boolean; hasMoves: boolean;`
    - `tiles: { value: number | null; days: number | null; cogs: number | null; slow: number | null; dead: number | null };`
    - `bridge: { opening: number; receipts: number; landed: number; deliveries: number; returns: number; adjustments: number; revaluation: number; closing: number } | null;`
    - `products: ProductStat[]; movements: { p: string; kind: MoveKind; q: number }[]; locations: { loc: string; inQ: number; outQ: number }[];`
    - `tieouts: TieOut[]; findings: Finding[]; headline: string }`
  - The rules:
    - `ProductStat` is `{ code, product, category, value, qty, cogs, days, turnover, abc: "A" | "B" | "C", lastOut, flag: "slow" | "dead" | null }`.
    - ABC is by cost of sales: the first 80% is A, the next 15% is B, the rest C.
    - Slow means no outgoing move in 90 days; dead means 180 days, counted to `opts.today ?? last period end`.
    - Stock days = closing value ÷ (period cost of sales ÷ days in period).
  - Tie-outs per period of the selection, keys exactly `stock_value`, `stock_movement`, `cogs`, `receipts`, `rental_value`, plus `qty_onhand` at the snapshot date:
    - `stock_value`: cumulative layers to month end against `ledger.stock[p]`.
    - `stock_movement`: the month's layers against `ledger.stock[p] − ledger.stock[prev]`.
    - `cogs`: `−(delivery + customer_return)` layers against `ledger.cogs[p]`.
    - `receipts`: receipt + landed − supplier_return layers against ledger refs of kinds receipt, landed and return. The ledger ref kind uses the same `layerKind(ref, "", sign)` rule.
    - `rental_value`: value on rental moves against 0.
    - `qty_onhand`: when both a snapshot and moves are loaded, compare per product the snapshot quantity (module side) against the net done moves up to `asOf` (ledger argument). Causes are product codes. It is a check inside the module, so the "ledger" side is the moves; it applies only when the moves start at the company's first stock month (`meta.periods[0]` ≤ the first layer month); otherwise it is absent.
    - byRef causes come from `d.byRef` and `d.ledger`.
  - Findings, `kind` `"risk" | "watch"` like the Sales findings:
    - stock growing faster than sales over 3 months;
    - slow plus dead above 10% of value;
    - negative on-hand quantity;
    - adjustments plus scrap above 1% of cost of sales;
    - a receipt without a landed cost from a supplier whose other receipts have one;
    - any tie-out `off`, as a risk naming the month and difference.

- [ ] **Step 1: Failing tests** (fixtures built in the test, FIFO by hand)
  - `bridgeClosesToTheCent`: receipts 10@100 and 10@110, landed 120, a delivery of 15 (value −1550 from FIFO layers), a customer return of 1 (+110), a scrap of 1 (−110).
    - Expect closing = opening + every component, and closing `== 1000+1100+120−1550+110−110`.
  - `cogsTiesToLedger`: ledger cogs `{2026-09: 1440}` (1550 − 110). Expect the `cogs` tie-out `ok`.
  - `stockValueOffNamesTheRef`: the ledger stock is 300 lower than layers, and the ledger refs lack `LC/2026/0001`. Expect `stock_value` `off`, with `causes[0].ref === "LC/2026/0001"`.
  - `rentalMovesCarryNoValue`: rental_out and rental_back moves with no layers. Expect `rental_value` `ok`; adding a layer of 50 on that ref turns it `off`.
  - `movesOnlyGivesQuantitiesAndNoValueTieOuts`: data with moves only. Expect `hasValue === false`, `tiles.value === null`, and every tie-out except `rental_value` absent. The page shows "needs the valuation export".
  - `slowAndDeadByLastOut`: products last out 100 and 200 days before `today` are flagged `slow` and `dead`.
  - `abcByCostOfSales`: three products with cost of sales 800/150/50 get A/B/C.
  - `onHandMatchesMoves`: a snapshot of P1 = 6 with moves +10 −4 gives `qty_onhand` `ok`; a snapshot of 7 gives `off` with `causes[0].ref === "P1"`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/inventory.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `inventoryAnalysis` to the interface. English text, with an `L(en, ar)` helper as in `src/lib/engine/bank.ts` for findings and the headline.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** with message `Inventory engine: value bridge, products, movements, findings and tie-outs to the ledger`.

### Task 8: Demo company stock history

**Files:**
- Create: `src/lib/company/demo-inventory.ts`
- Test: `tests/unit/inventory.test.ts` (`demoTiesOutEveryMonth`)

**Interfaces:**
- Consumes: `reference/sample.json` months (balance-sheet `inventory`, cost of sales); `demoExpenses()` "Cost of goods sold (stock)" amounts.
- Produces: `demoInventory(): InventoryData`.
  - Per month, the layers are built so that:
    - the sum of delivery layers = −(that month's stock cost of sales);
    - the sum of all layers = the change in balance-sheet inventory;
    - receipts are the remainder, split over 6 made-up products with FIFO unit costs.
  - It adds a rental location with zero-value moves, one landed cost per quarter, and `byRef`/`ledger` refs that match one for one.

- [ ] **Step 1: Failing test `demoTiesOutEveryMonth`.** Every tie-out of `inventoryAnalysis(demoInventory(), {type:"year", end:"2026-09"}, {ledger: …})`, with the ledger taken from the sample months, is `ok`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** with message `Demo: a stock history that ties to the demo accounts`.

### Task 9: Sheet roles and the upload wizard

**Files:**
- Modify: `src/lib/ingest/roles.ts`:
  - add the roles `stock_valuation`, `stock_moves`, `stock_onhand`, `products`;
  - labels; `ROLE_ORDER`; `IMPORTED`;
  - checks in `guessRole` before the bills and sales checks, since a valuation list also has dates and amounts.
- Modify: `src/components/settings/upload-wizard.tsx`:
  - `Kind` gains `"inventory"`;
  - a fourth `ChoiceCard` "My stock" (`testId="pick-inventory"`);
  - get-file steps for the four Odoo exports, each saying "tick *I want to update data (import-compatible export)*";
  - the reading panel's `gives` text per inventory sheet ("N layers, value EGP X");
  - the save calls `saveInventory`, then shows "N added · M already here";
  - accounts uploads also save `stockFromLedger(res.lines)` as ledger kind `"stock"`, next to line 366.
- Modify: `src/components/upload/sheet-roles.tsx` (the new roles in the role picker).
- Modify: `src/app/company/[id]/settings/actions.ts` (`saveInventorySettings(companyId, { rentalLocation: string | null })`, stored the same way as `saveAssumptions`, under key `inventory`). The wizard shows a "Rental location" select when a moves sheet is read: its options are the sheet's locations, defaulting to the regex match. The choice is passed to `readStockMoves` and saved.
- Modify: `src/components/setup/data-setup.tsx` (an Inventory card).
- Test: `tests/unit/roles.test.ts` (extend), `tests/e2e/demo.spec.ts` (new test)

**Interfaces:**
- Consumes: Tasks 2, 3 and 5.
- Produces: `SheetRole` includes `"stock_valuation" | "stock_moves" | "stock_onhand" | "products"`.

- [ ] **Step 1: Failing tests**
  - Unit `routesInventorySheets`: `guessRole` of the Task 2 valuation grid gives `stock_valuation` with `sure`; the moves grid gives `stock_moves`; the on-hand grid gives `stock_onhand`; and the existing sales and bills fixtures still give `sales` / `bills`.
  - e2e `inventory upload: each sheet goes to Inventory only, and the same file twice adds nothing`, on `/demo/settings/source-data`:
    - pick "My stock" and upload a generated two-sheet workbook (valuation plus moves; built in the test with `xlsx`, made-up data);
    - expect the reading panel to show both sheets as Inventory roles;
    - save, and expect "added";
    - upload again in "Add only new" mode, and expect "0 added".
    - In the demo, saving is simulated the way the existing demo uploads are; the signed-in version is in Task 11.
- [ ] **Step 2: Run** `npx vitest run tests/unit/roles.test.ts` and `npx playwright test tests/e2e/demo.spec.ts -g "inventory upload"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both. Expected: PASS. Then run the full unit suite and `npx playwright test tests/e2e/demo.spec.ts` (no regressions in the existing wizard tests).
- [ ] **Step 5: Commit** with message `Upload: Inventory sheets recognised and saved to Inventory only`.

### Task 10: Inventory pages, sector and words

**Files:**
- Modify: `src/components/shell/nav.ts`:
  - `SectorKey` gains `"inventory"`;
  - a sector with Overview (`inventory`), Products (`inventory/products`), Movements (`inventory/movements`) and Valuation (`inventory/valuation`);
  - `sectorOf` recognises `inventory`;
  - the i18n nav labels: an `inventory` key in the existing nav area of `en.ts`/`ar.ts`.
- Create the routes:
  - `src/app/company/[id]/inventory/{layout.tsx,page.tsx,products/page.tsx,movements/page.tsx,valuation/page.tsx}`. The layout loads `loadInventory(id)` and `loadExpenses(id)` (cost of sales from stock for the tie-out), the same as the expenses layout.
  - `src/app/demo/inventory/...` the same, with `demoInventory()` and `demoExpenses()`.
- Create the components: `src/components/inventory/{common.tsx,inventory-overview.tsx,inventory-products.tsx,inventory-movements.tsx,inventory-valuation.tsx}`.
- Create: `src/lib/i18n/areas/inv.ts` (English and Arabic), registered in `en.ts`/`ar.ts` as `inv`.
- Test: `tests/e2e/demo.spec.ts`, `tests/e2e/crawl.spec.ts` (the new routes are in the crawl list)

**Interfaces:**
- Consumes: `useInventory()`, `useExpenses()`, `useCompany()` months (the balance-sheet `inventory` per period), and `inventoryAnalysis`.
- Produces: the pages, with test ids:
  - Overview: `inv-headline`, `inv-tiles`, `inv-bridge`, `inv-tieouts` (banner and table), `inv-findings`.
  - Products: `inv-products` (table with ABC, slow and dead filters).
  - Movements: `inv-movements`, `inv-locations`.
  - Valuation: `inv-layers`, `inv-tieout-table` (each row: month, module, ledger, difference, status chip, causes expandable).
- Charts reuse `src/components/charts/*`: the waterfall for the bridge, the line chart for stock value against cost of sales, bar-list for top products.

- [ ] **Step 1: Failing e2e test `inventory pages show the demo stock and every tie-out green`.**
  - `/demo/inventory`: `inv-headline` visible; `inv-tieouts` contains "All checks agree with the accounts".
  - `/demo/inventory/products`: `inv-products` has at least 6 rows and an "A" class chip.
  - `/demo/inventory/valuation`: `inv-tieout-table` has no "off" chip.
  - The crawl passes with the four new demo routes and returns no console errors.
- [ ] **Step 2: Run** `npx playwright test tests/e2e/demo.spec.ts -g "inventory pages"`. Expected: FAIL.
- [ ] **Step 3: Implement** the pages in the look of `src/components/expenses/*` (tiles, H2 sections, tables with `tbl`, findings list); the words come from `d.inv`.
- [ ] **Step 4: Run** the test, then `npx vitest run tests/unit/i18n.test.ts` (dictionary complete). Expected: PASS.
- [ ] **Step 5: Commit** with message `Inventory pages: overview, products, movements and valuation with the tie-out table`.

### Task 11: Readiness, Data health and the signed-in save

**Files:**
- Modify: `src/lib/company/readiness.ts`:
  - `ReadinessSector` gains `"inventory"`;
  - `inventoryReadiness(x)` items: valuation loaded, moves loaded, on hand loaded, Odoo IDs present, each tie-out passing;
  - added to `readiness()`.
- Modify: `src/components/setup/readiness-view.tsx` (show the card on `/inventory`).
- Modify: `src/components/settings/data-health.tsx` (a "Stock against the accounts" table from the same tie-outs).
- Test: `tests/unit/readiness.test.ts` (extend), `tests/e2e-auth/company.spec.ts` (new test)

**Interfaces:**
- Consumes: `inventoryAnalysis(...).tieouts`; `InventoryData.meta`.

- [ ] **Step 1: Failing tests**
  - Unit `inventoryReadinessCountsTieOuts`: with valuation and moves loaded, no IDs, and one tie-out off. Expect completion below 100, accuracy below 100, and an item "Export with Odoo IDs".
  - Signed-in e2e `inventory save is all-or-nothing and duplicates are refused`:
    - upload the generated workbook to a fresh company, and expect the stored layer count to equal the rows;
    - re-upload in Add-only-new, and expect the count unchanged and "already here";
    - re-upload under Replace with the same filename, and expect the count unchanged.
- [ ] **Step 2: Run** `npx vitest run tests/unit/readiness.test.ts` and `npm run e2e:auth -- -g "inventory save"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both. Expected: PASS.
- [ ] **Step 5: Commit** with message `Inventory: readiness card, Data health tie-outs and the signed-in save`.

### Task 12: Real-file proof, full suites, push

**Files:** none in the repo. Real exports stay in the scratchpad; only new reader fixes, if any, go into the repo with made-up fixtures.

- [ ] **Step 1: Read the owner's sample.** Run the readers on the owner's three Inventory exports and that month's General Ledger, through a scratch test under the scratchpad (not committed). Print every tie-out with its causes.
- [ ] **Step 2: Fix and re-check.** Every tie-out must be 0, or each cause explained (for example an export filtered by date). Fix reader rules with a made-up regression test for each fix.
- [ ] **Step 3: Full checks.** Run `npx tsc --noEmit && npx eslint . && npx vitest run`, then `set -a; . .local-supabase/env; set +a; npm run build`, then `npx playwright test`, then `npm run e2e:auth`. Expected: all pass.
- [ ] **Step 4: Push.** Push to `claude/sharp-pasteur-ms9hn6` and confirm CI is green. Hand the owner `supabase/migrations/0012_inventory.sql` to paste into the live SQL editor, then confirm the tables and functions on the live database by reading `pg_proc` and `information_schema`.
