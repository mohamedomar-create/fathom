import { addMonths, bsCalc, cashFlowByMonth, COSTS_DEFINITION, EXPENSE_GROUPS, expenseMonths, hasBS, hasPL, isAnnualColumn, isCostLine, mlabel, monthIndex, NOT_SUPPLIERS, plCalc, type Assumptions, type ExpensesData, type ForecastDrivers, type MonthData, type SalesData } from "@/lib/engine";
import { inventoryLedger, inventoryTieOuts, type InventoryData } from "@/lib/engine/inventory";
import type { TieOut } from "@/lib/engine/tieout";
import type { TemplateKind } from "@/lib/templates/spec";
import type { Check } from "./checks";

/**
 * How ready each sector's data is: what is loaded (completion) and how much of it passes the accounting checks
 * (accuracy), item by item, each with exactly what to upload or enter and how.
 */
export type ReadinessSector = "financials" | "sales" | "expenses" | "inventory" | "banking" | "forecast";
export type ItemStatus = "done" | "partial" | "missing";

export interface ReadinessFix {
  /** What to provide, in one line. */
  what: string;
  /** How to get it (the Odoo menu path, or the iReport page). */
  how: string;
  /** The iReport template that holds it. */
  template?: TemplateKind;
  /** Where in iReport to do it, relative to the company's base path. */
  href?: string;
}
export interface ReadinessItem {
  id: string;
  /** Short name for the radar axis. */
  axis: string;
  title: string;
  /** 0–100: how much of what this item needs is loaded or entered. */
  completion: number;
  /** 0–100: how much of what is loaded passes its checks; null when there is nothing to check. */
  accuracy: number | null;
  status: ItemStatus;
  detail: string;
  fix?: ReadinessFix;
}
/** accuracy is null when nothing loaded can be checked yet (or nothing in the sector is checkable). */
export interface SectorReadiness { key: ReadinessSector; label: string; completion: number; accuracy: number | null; items: ReadinessItem[] }

export interface ReadinessInput {
  months: MonthData[];
  checks: Check[];
  fyStart: number;
  sales?: SalesData | null;
  expenses?: ExpensesData | null;
  inventory?: InventoryData | null;
  /** The accounts by code and name (the stock interim accounts feed the cost-of-sales check). */
  accounts?: { name: string; cls: string; amounts: Record<string, number> }[];
  assumptions?: Assumptions;
  forecast?: ForecastDrivers;
  today?: string;
  /** The company said its books start from zero (nothing before the first month), so no opening balance is due. */
  booksFromZero?: boolean;
}

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);
const status = (c: number, a: number | null): ItemStatus => (c >= 100 && (a === null || a >= 100) ? "done" : c <= 0 ? "missing" : "partial");
const item = (i: Omit<ReadinessItem, "status">): ReadinessItem => ({ ...i, status: status(i.completion, i.accuracy) });
const isoToday = () => new Date().toISOString().slice(0, 10);

const GL_FIX: ReadinessFix = { what: "Upload your General Ledger for this year", how: "Odoo: Accounting → Reporting → General Ledger → Export. Or use our template.", template: "financials", href: "settings/source-data" };

function summarise(items: ReadinessItem[]): { completion: number; accuracy: number | null } {
  const completion = Math.round(items.reduce((s, i) => s + i.completion, 0) / Math.max(1, items.length));
  const acc = items.filter((i) => i.accuracy !== null && i.completion > 0);
  const accuracy = acc.length ? Math.round(acc.reduce((s, i) => s + i.accuracy!, 0) / acc.length) : null;
  return { completion, accuracy };
}

/** Months holding a P&L, oldest first. */
const plMonths = (ms: MonthData[]) => [...ms].filter(hasPL).sort((a, b) => a.period.localeCompare(b.period));

export function financialsReadiness(x: ReadinessInput): SectorReadiness {
  const pl = plMonths(x.months);
  const by = new Map(x.months.map((m) => [m.period, m]));
  const items: ReadinessItem[] = [];
  const last12 = pl.slice(-12);
  const blockedIn = (p: string, st?: "PL" | "BS") => x.checks.some((c) => c.severity === "block" && c.period === p && (!st || !c.statement || c.statement === st));
  const annual = pl.length > 0 && isAnnualColumn(x.months, pl[pl.length - 1].period, x.fyStart);
  if (!pl.length) {
    items.push(item({ id: "pl", axis: "P&L months", title: "Monthly P&L", completion: 0, accuracy: null, detail: "No P&L is loaded yet.", fix: GL_FIX }));
  } else {
    const n = annual ? 12 : last12.length;
    items.push(item({
      id: "pl", axis: "P&L months", title: "Monthly P&L for the last 12 months",
      completion: pct(n / 12), accuracy: pct(1 - last12.filter((m) => blockedIn(m.period, "PL")).length / Math.max(1, last12.length)),
      detail: annual ? "Loaded as annual figures (audited statements): monthly analysis, trends and the forecast need monthly figures." : `${last12.length} of the last 12 months have a P&L (${mlabel(last12[0].period)} to ${mlabel(last12[last12.length - 1].period)}).`,
      fix: n < 12 || annual ? { ...GL_FIX, what: annual ? "Upload month-by-month figures (General Ledger), 12 months" : `Upload ${12 - n} earlier month${12 - n === 1 ? "" : "s"}` } : undefined,
    }));
  }
  const withBS = last12.filter(hasBS);
  const balanced = withBS.filter((m) => { const b = bsCalc(m.bs); return Math.abs(b.imbalance) <= Math.max(1, Math.abs(b.ta) * 1e-4); });
  items.push(item({
    id: "bs", axis: "Balance sheets", title: "A balance sheet at every month end",
    completion: pl.length ? pct(withBS.length / last12.length) : 0, accuracy: withBS.length ? pct(balanced.length / withBS.length) : null,
    detail: !pl.length ? "No months loaded." : `${withBS.length} of ${last12.length} months have a balance sheet; ${balanced.length} of them balance.`,
    fix: withBS.length < last12.length ? { what: "Upload a balance sheet for each month", how: GL_FIX.how, template: "financials", href: "settings/source-data" }
      : balanced.length < withBS.length ? { what: "Fix the months that don't balance", how: "Data health shows which months, and by how much.", href: "settings/data-health" } : undefined,
  }));
  const first = pl[0]?.period;
  const open = first ? by.get(addMonths(first, -1)) : undefined;
  const openOk = !!open && hasBS(open);
  const openBal = openOk ? Math.abs(bsCalc(open!.bs).imbalance) <= Math.max(1, Math.abs(bsCalc(open!.bs).ta) * 1e-4) : false;
  if (!openOk && first && x.booksFromZero) items.push(item({
    id: "opening", axis: "Opening balance", title: "Opening balance sheet (the month before the first month)",
    completion: 100, accuracy: null, detail: `Your books start from zero: nothing before ${mlabel(first)}.`,
  }));
  else items.push(item({
    id: "opening", axis: "Opening balance", title: "Opening balance sheet (the month before the first month)",
    completion: openOk ? 100 : 0, accuracy: openOk ? (openBal ? 100 : 0) : null,
    detail: !first ? "No months loaded." : openOk ? `Loaded for ${mlabel(open!.period)}${openBal ? "" : ", but it does not balance"}.` : `Not loaded: ${mlabel(first)} has no cash flow without it.`,
    fix: openOk ? undefined : { what: `Add opening balances: General Ledger from ${first ? mlabel(first) : "the first month"} with "Initial balance"`, how: "In Odoo, tick Initial balance. In our template, fill the first column.", template: "financials", href: "settings/source-data" },
  }));
  if (pl.length) {
    const span = monthIndex(pl[pl.length - 1].period) - monthIndex(pl[0].period) + 1;
    const gaps = annual ? 0 : span - pl.length;
    items.push(item({
      id: "gaps", axis: "No gaps", title: "Every month between the first and the latest",
      completion: pct(1 - gaps / Math.max(1, span)), accuracy: null,
      detail: gaps ? `${gaps} month${gaps === 1 ? " is" : "s are"} missing inside the range loaded.` : "No missing months.",
      fix: gaps ? { ...GL_FIX, what: "Upload the missing months", href: "settings/data-health" } : undefined,
    }));
    const today = x.today ?? isoToday();
    const behind = monthIndex(today.slice(0, 7)) - monthIndex(pl[pl.length - 1].period);
    items.push(item({
      id: "fresh", axis: "Up to date", title: "The latest month is loaded",
      completion: behind <= 1 ? 100 : behind === 2 ? 60 : behind === 3 ? 30 : 0, accuracy: null,
      detail: `Latest month: ${mlabel(pl[pl.length - 1].period)}.`,
      fix: behind > 1 ? { ...GL_FIX, what: `Upload the months after ${mlabel(pl[pl.length - 1].period)}` } : undefined,
    }));
    const cf = cashFlowByMonth(x.months, last12.map((m) => m.period));
    const clean = cf.rows.filter((r) => r.unreconciled === 0).length;
    items.push(item({
      id: "cash", axis: "Cash reconciles", title: "Cash flow explains the change in cash every month",
      completion: pct(cf.rows.length / Math.max(1, last12.length)), accuracy: cf.rows.length ? pct(clean / cf.rows.length) : null,
      detail: cf.rows.length ? `${clean} of ${cf.rows.length} months reconcile to the cent.` : "Needs a balance sheet for each month and the month before.",
      fix: cf.rows.length && clean < cf.rows.length ? { what: "Fix the months where cash doesn't add up", how: "Data health shows the month and the amount.", href: "settings/data-health" } : undefined,
    }));
  }
  return { key: "financials", label: "Financials", ...summarise(items), items };
}

export function salesReadiness(x: ReadinessInput): SectorReadiness {
  const s = x.sales;
  const SALES_FIX: ReadinessFix = { what: "Upload your sales", how: "Odoo: Invoicing → Reporting → Invoice Analysis → list view → Export. Or use our template.", template: "sales", href: "settings/source-data" };
  const months = s ? [...new Set(s.customers.map((r) => r.p))].sort() : [];
  const items: ReadinessItem[] = [];
  if (!s || !months.length) {
    items.push(item({ id: "loaded", axis: "Sales loaded", title: "Sales lines", completion: 0, accuracy: null, detail: "No sales loaded yet.", fix: SALES_FIX }));
    return { key: "sales", label: "Sales", ...summarise(items), items };
  }
  const pl = plMonths(x.months).slice(-12);
  const plSet = new Set(pl.map((m) => m.period));
  const covered = pl.length ? pl.filter((m) => months.includes(m.period)).length / pl.length : 1;
  items.push(item({ id: "loaded", axis: "Months covered", title: "Sales for every financial month", completion: pct(covered), accuracy: null,
    detail: pl.length ? `${pl.filter((m) => months.includes(m.period)).length} of ${pl.length} financial months have sales lines.` : `${months.length} months of sales.`,
    fix: covered < 1 ? { ...SALES_FIX, what: "Upload sales for the missing months" } : undefined }));
  const byMonth = new Map<string, number>();
  for (const r of s.customers) byMonth.set(r.p, (byMonth.get(r.p) ?? 0) + r.a);
  const both = pl.filter((m) => byMonth.has(m.period) && plSet.has(m.period));
  const tied = both.filter((m) => { const rev = plCalc(m.pl).revenue; return Math.abs((byMonth.get(m.period) ?? 0) - rev) <= Math.max(1, Math.abs(rev) * 0.01); });
  items.push(item({ id: "reconciled", axis: "Ties to P&L", title: "Monthly sales equal P&L revenue (within 1%)", completion: both.length ? 100 : 0, accuracy: both.length ? pct(tied.length / both.length) : null,
    detail: both.length ? `${tied.length} of ${both.length} months tie to revenue.` : "Load the P&L for the same months to check.",
    fix: both.length && tied.length < both.length ? { what: "Make sales match the P&L", how: "Export all invoices and credit notes for the month, before VAT.", template: "sales", href: "sales" } : undefined }));
  const total = s.customers.reduce((t, r) => t + Math.abs(r.a), 0) || 1;
  const named = s.customers.filter((r) => r.c && r.c !== "No customer").reduce((t, r) => t + Math.abs(r.a), 0);
  items.push(item({ id: "customers", axis: "Customers", title: "Every sale has a customer", completion: pct(named / total), accuracy: null, detail: `${pct(named / total)}% of sales name the customer.`,
    fix: named < total ? { what: "Give each sale a customer", how: "Fill the Customer column.", template: "sales" } : undefined }));
  const ptotal = s.products.reduce((t, r) => t + Math.abs(r.a), 0) || 1;
  const cat = s.products.filter((r) => r.g && r.g !== "No category").reduce((t, r) => t + Math.abs(r.a), 0);
  items.push(item({ id: "categories", axis: "Categories", title: "Products have a category", completion: pct(cat / ptotal), accuracy: null, detail: `${pct(cat / ptotal)}% of sales have a product category.`,
    fix: cat < ptotal ? { what: "Add the product category", how: "Fill the Product category column.", template: "sales" } : undefined }));
  const qty = s.products.filter((r) => r.q !== null).reduce((t, r) => t + Math.abs(r.a), 0);
  items.push(item({ id: "qty", axis: "Quantities", title: "Quantities sold", completion: pct(qty / ptotal), accuracy: null, detail: qty ? `${pct(qty / ptotal)}% of sales have quantities.` : "No quantities: price and volume effects cannot be shown.",
    fix: qty < ptotal ? { what: "Add quantities", how: "Upload the Invoice Analysis, or fill the Quantity column.", template: "sales" } : undefined }));
  const costed = s.products.reduce((t, r) => t + Math.abs(r.ka ?? 0), 0);
  items.push(item({ id: "cost", axis: "Cost & margin", title: "Cost of each sale (for margins)", completion: pct(costed / ptotal), accuracy: null, detail: costed ? `${pct(costed / ptotal)}% of sales have their cost.` : "No cost per sale: product margins cannot be shown.",
    fix: costed < ptotal ? { what: "Add the cost of each sale", how: "Fill the Cost column (or export Margin from Odoo).", template: "sales" } : undefined }));
  return { key: "sales", label: "Sales", ...summarise(items), items };
}

const COST_CLASSES = EXPENSE_GROUPS.flatMap((g) => g.classes);
/** A month's P&L costs, as the Expenses pages add them up. */
const COS_CLASSES = ["cos_variable", "cos_fixed", "cos_depreciation"] as const;
const costsOf = (m: MonthData) => COST_CLASSES.reduce((t, k) => t + ((m.pl as Record<string, number>)[k] ?? 0), 0);

export function expensesReadiness(x: ReadinessInput): SectorReadiness {
  const e = x.expenses;
  const FIX: ReadinessFix = { what: "Upload your General Ledger", how: "Odoo: Accounting → Reporting → General Ledger → Export. Its cost lines show who you pay.", template: "financials", href: "settings/source-data?step=financials" };
  const months = e ? expenseMonths(e) : [];
  const items: ReadinessItem[] = [];
  if (!e || !months.length) {
    items.push(item({ id: "loaded", axis: "Lines loaded", title: "Expense lines (who you pay)", completion: 0, accuracy: null, detail: "No expense lines yet. Your costs show from the P&L; suppliers need the lines.", fix: FIX }));
    return { key: "expenses", label: "Expenses", ...summarise(items), items };
  }
  const pl = plMonths(x.months).slice(-12);
  const n = pl.filter((m) => months.includes(m.period)).length;
  const covered = pl.length ? n / pl.length : 1;
  items.push(item({ id: "loaded", axis: "Months covered", title: "Expense lines for every financial month", completion: pct(covered), accuracy: null,
    detail: pl.length ? `${n} of ${pl.length} financial months have expense lines.` : `${months.length} months of expense lines.`,
    fix: covered < 1 ? { ...FIX, what: "Upload the General Ledger for the missing months" } : undefined }));
  const byMonth = new Map<string, number>();
  for (const r of e.suppliers) if (isCostLine(r.c)) byMonth.set(r.p, (byMonth.get(r.p) ?? 0) + r.a);
  const both = pl.filter((m) => byMonth.has(m.period));
  const tied = both.filter((m) => { const c = costsOf(m); return Math.abs((byMonth.get(m.period) ?? 0) - c) <= Math.max(1, Math.abs(c) * 0.01); });
  // Cost of sales is part of P&L costs: lines that leave it out (a bills list, or an expense file without the stock
  // journal) can never tie, and the reason is said with the amount.
  const cosOf = (m: MonthData) => COS_CLASSES.reduce((t, k) => t + ((m.pl as Record<string, number>)[k] ?? 0), 0);
  const cosLines = new Map<string, number>();
  for (const r of e.suppliers) if (COS_CLASSES.includes(r.c as (typeof COS_CLASSES)[number])) cosLines.set(r.p, (cosLines.get(r.p) ?? 0) + r.a);
  const noCos = both.filter((m) => cosOf(m) > 1 && Math.abs(cosLines.get(m.period) ?? 0) < cosOf(m) * 0.01);
  const missing = noCos.length ? noCos.reduce((t, m) => t + cosOf(m), 0) / noCos.length : 0;
  items.push(item({ id: "reconciled", axis: "Ties to P&L", title: "Monthly lines equal P&L costs (within 1%)", completion: both.length ? 100 : 0, accuracy: both.length ? pct(tied.length / both.length) : null,
    detail: (both.length ? `${tied.length} of ${both.length} months tie to the P&L.` : "Load the P&L for the same months to check.")
      + (noCos.length ? ` Cost of sales missing: ${Math.round(missing).toLocaleString("en-US")} a month on average, in ${noCos.length} month${noCos.length > 1 ? "s" : ""}.` : "")
      + ` ${COSTS_DEFINITION}`,
    fix: both.length && tied.length < both.length ? (noCos.length
      ? { what: "Include cost of sales in the expense lines", how: "Include cost of sales, salaries, rent, depreciation and every other cost, so each month matches your P&L. The General Ledger has them all.", template: "financials", href: "expenses/trend" }
      : { what: "Use the General Ledger for all costs", how: "A bills file holds bills only. The ledger also has salaries, rent and depreciation.", template: "financials", href: "expenses/trend" }) : undefined }));
  const pay = e.suppliers.filter((r) => r.s !== "Depreciation (no payment)" && r.s !== "Cost of goods sold (stock)" && isCostLine(r.c));
  const total = pay.reduce((t, r) => t + Math.abs(r.a), 0) || 1;
  const named = pay.filter((r) => !NOT_SUPPLIERS.has(r.s)).reduce((t, r) => t + Math.abs(r.a), 0);
  items.push(item({ id: "suppliers", axis: "Suppliers named", title: "Payments name the supplier", completion: pct(named / total / 0.8), accuracy: null,
    detail: `${pct(named / total)}% of spend names who was paid (salaries usually don't; 80% is plenty).`,
    fix: named / total < 0.8 ? { what: "Fill the Partner on bills and payments", how: "In Odoo, set the Vendor on each bill. In our template, fill Supplier.", template: "expenses" } : undefined }));
  const costAcc = e.accounts.filter((r) => isCostLine(r.c));
  const atotal = costAcc.reduce((t, r) => t + Math.abs(r.a), 0) || 1;
  const typed = costAcc.filter((r) => r.c).reduce((t, r) => t + Math.abs(r.a), 0);
  items.push(item({ id: "types", axis: "Cost types", title: "Each line has a cost type", completion: pct(typed / atotal), accuracy: null, detail: `${pct(typed / atotal)}% of spend has a cost type (rent, salaries, materials…).`,
    fix: typed < atotal ? { what: "Give each line an expense type", how: "Fill the Expense type column with a plain name, like Rent.", template: "expenses" } : undefined }));
  const latest = pl[pl.length - 1]?.period;
  if (latest) items.push(item({ id: "fresh", axis: "Up to date", title: "The latest month has expense lines", completion: months.includes(latest) ? 100 : 0, accuracy: null,
    detail: months.includes(latest) ? `${mlabel(latest)} is in.` : `${mlabel(latest)} has no expense lines yet.`,
    fix: months.includes(latest) ? undefined : { ...FIX, what: `Upload the General Ledger for ${mlabel(latest)}` } }));
  return { key: "expenses", label: "Expenses", ...summarise(items), items };
}

const STOCK_EXPORT = "Odoo: Inventory → Reporting → Valuation (and Moves History, Stock) → list view → tick the top box and click “Select all N records” → Export, with “I want to update data (import-compatible export)” ticked and the ID field added (never External ID).";
const TIE_NAMES: [TieOut["key"], string, string][] = [
  ["stock_value", "Stock value", "Stock value equals the stock accounts"], ["stock_movement", "Stock change", "Each month's change in stock equals the accounts"],
  ["cogs", "Cost of sales", "Cost of goods delivered equals cost of sales in the accounts"], ["receipts", "Receipts", "Goods received and landed costs equal the stock postings"],
  ["rental_value", "Rentals", "Rental moves carry no value"], ["qty_onhand", "Warehouse units", "Odoo’s stock list equals the moves into the warehouses"],
  ["qty_valued", "Units valued", "Units valued equal the units the moves hold"], ["onhand_value", "Value by location", "Stock value equals warehouses + on rental + in transit"],
];

/** Stock: what is loaded (valuation, moves, on hand, with Odoo IDs) and, per check, how many months agree with the accounts (last 12 months with stock records). */
export function inventoryReadiness(x: ReadinessInput): SectorReadiness {
  const d = x.inventory;
  const FIX: ReadinessFix = { what: "Upload the stock valuation", how: STOCK_EXPORT, href: "settings/source-data?step=inventory" };
  const items: ReadinessItem[] = [];
  if (!d || (!d.layers.length && !d.moves.months.length && !d.onhand.length)) {
    items.push(item({ id: "valuation", axis: "Valuation", title: "Stock records (optional)", completion: 0, accuracy: null, detail: "No stock records yet. Inventory pages need Odoo's stock valuation.", fix: FIX }));
    return { key: "inventory", label: "Inventory", ...summarise(items), items };
  }
  const loaded = (id: string, axis: string, title: string, has: boolean, what: string) =>
    items.push(item({ id, axis, title, completion: has ? 100 : 0, accuracy: null, detail: has ? "Loaded." : "Not loaded.", fix: has ? undefined : { ...FIX, what } }));
  loaded("valuation", "Valuation", "Stock valuation (the money)", d.layers.length > 0, "Upload the stock valuation");
  loaded("moves", "Moves", "Moves history (quantities and locations)", d.moves.months.length > 0, "Upload the moves history");
  loaded("onhand", "On hand", "Stock on hand (the closing count)", d.onhand.length > 0, "Upload stock on hand");
  items.push(item({ id: "ids", axis: "Odoo IDs", title: "Exported with Odoo's record IDs", completion: d.meta.withIds ? 100 : 0, accuracy: null,
    detail: d.meta.withIds ? "Every record carries its Odoo ID: duplicates are refused exactly." : "Records are matched by date, document, product and amounts instead of Odoo's ID.",
    fix: d.meta.withIds ? undefined : { what: "Export with Odoo IDs", how: "When exporting from Odoo, tick “I want to update data (import-compatible export)” and add the ID field (the database ID). Do not add External ID: Odoo would create new records to make those IDs.", href: "settings/source-data?step=inventory" } }));
  const ties = inventoryTieOuts(d, inventoryLedger(x.months, x.expenses ?? { suppliers: [] }, x.accounts), x.fyStart, 12);
  for (const [key, axis, title] of TIE_NAMES) {
    const all = ties.filter((t) => t.key === key);
    if (!all.length) continue;
    const checked = all.filter((t) => t.status !== "no_ledger"), ok = checked.filter((t) => t.status === "ok");
    items.push(item({ id: `tie_${key}`, axis, title, completion: checked.length ? 100 : 0, accuracy: checked.length ? pct(ok.length / checked.length) : null,
      detail: checked.length ? `${ok.length} of ${checked.length} month${checked.length === 1 ? "" : "s"} agree.` : "Nothing in the accounts to check against yet.",
      fix: !checked.length ? { ...GL_FIX, what: "Upload your General Ledger for the same months" } : ok.length < checked.length ? { what: "Find the documents behind each difference", how: "On the Valuation page, each difference lists its documents.", href: "inventory/valuation" } : undefined }));
  }
  return { key: "inventory", label: "Inventory", ...summarise(items), items };
}

export function bankingReadiness(x: ReadinessInput): SectorReadiness {
  const pl = plMonths(x.months);
  const a = x.assumptions ?? {};
  const annualYears = pl.filter((m) => isAnnualColumn(x.months, m.period, x.fyStart)).length;
  const items: ReadinessItem[] = [];
  const hist = annualYears >= 3 ? 1 : Math.max(pl.length / 24, annualYears / 3);
  items.push(item({ id: "history", axis: "History", title: "Two years of months, or three audited years", completion: pct(hist), accuracy: null,
    detail: `${pl.length} months${annualYears ? ` (${annualYears} annual)` : ""} loaded. Banks look at 2–3 years.`,
    fix: hist < 1 ? { what: "Add earlier years", how: "Upload each year's General Ledger, or audited statements (PDF works).", template: "financials", href: "settings/source-data" } : undefined }));
  const last = [...x.months].filter(hasBS).sort((p, q) => p.period.localeCompare(q.period)).pop();
  const debt = last ? bsCalc(last.bs).debt : 0;
  const hasNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  items.push(item({ id: "repay", axis: "Repayments", title: "Loan principal due in the next 12 months", completion: debt <= 0 || hasNum(a.principal12m) ? 100 : 0, accuracy: null,
    detail: debt <= 0 ? "No borrowing on the latest balance sheet." : hasNum(a.principal12m) ? "Entered." : "Not entered: debt service is estimated.",
    fix: debt > 0 && !hasNum(a.principal12m) ? { what: "Enter loan payments due in the next 12 months", how: "On the Banking page.", href: "banking" } : undefined }));
  items.push(item({ id: "rate", axis: "Borrowing rate", title: "Your borrowing rate", completion: hasNum(a.rate) ? 100 : 0, accuracy: null, detail: hasNum(a.rate) ? `${a.rate}% a year.` : "Not entered.",
    fix: hasNum(a.rate) ? undefined : { what: "Enter your loan rate", how: "On the Banking page.", href: "banking" } }));
  items.push(item({ id: "request", axis: "Request", title: "The loan you want to ask for", completion: hasNum(a.requestAmount) ? 100 : 0, accuracy: null, detail: hasNum(a.requestAmount) ? "Entered." : "Not entered.",
    fix: hasNum(a.requestAmount) ? undefined : { what: "Enter the loan you want", how: "On the Banking page.", href: "banking" } }));
  items.push(item({ id: "economy", axis: "Inflation & FX", title: "Inflation and exchange rates", completion: hasNum(a.inflation) ? (hasNum(a.fxStart) && hasNum(a.fxEnd) ? 100 : 60) : 0, accuracy: null,
    detail: hasNum(a.inflation) ? "Entered." : "Not entered: real growth cannot be judged.",
    fix: hasNum(a.inflation) && hasNum(a.fxStart) && hasNum(a.fxEnd) ? undefined : { what: "Enter inflation and the dollar rate", how: "On the Real Profit page.", href: "analysis/real-profit" } }));
  const fin = financialsReadiness(x);
  const bal = fin.items.find((i) => i.id === "bs");
  if (bal) items.push({ ...bal, axis: "Balance sheets" });
  return { key: "banking", label: "Banking", ...summarise(items), items };
}

export function forecastReadiness(x: ReadinessInput): SectorReadiness {
  const pl = plMonths(x.months);
  let run = pl.length ? 1 : 0;
  for (let i = pl.length - 1; i > 0 && monthIndex(pl[i].period) - monthIndex(pl[i - 1].period) === 1; i--) run++;
  const last = pl[pl.length - 1];
  const items: ReadinessItem[] = [
    item({ id: "run", axis: "History", title: "12 or more consecutive months (24 for seasonality)", completion: pct(run / 12), accuracy: null, detail: `${run} consecutive months up to the latest.`,
      fix: run < 12 ? { ...GL_FIX, what: "Upload earlier months: 12 in a row" } : undefined }),
    item({ id: "start", axis: "Starting point", title: "The latest month has a balance sheet", completion: last && hasBS(last) ? 100 : 0, accuracy: null,
      detail: last ? (hasBS(last) ? `Starts from ${mlabel(last.period)}.` : `${mlabel(last.period)} has no balance sheet.`) : "No months loaded.",
      fix: last && hasBS(last) ? undefined : { ...GL_FIX, what: "Upload the balance sheet for the latest month" } }),
    item({ id: "drivers", axis: "Drivers", title: "Forecast drivers reviewed and saved", completion: x.forecast && Object.keys(x.forecast).length ? 100 : 0, accuracy: null,
      detail: x.forecast && Object.keys(x.forecast).length ? "Saved for this company." : "Using the measured defaults; review growth, margin, days and loans.",
      fix: x.forecast && Object.keys(x.forecast).length ? undefined : { what: "Check the forecast settings and save", how: "On the Forecast page.", href: "analysis/forecast" } }),
  ];
  return { key: "forecast", label: "Forecast", ...summarise(items), items };
}

export function readiness(x: ReadinessInput): SectorReadiness[] {
  return [financialsReadiness(x), salesReadiness(x), expensesReadiness(x), inventoryReadiness(x), bankingReadiness(x), forecastReadiness(x)];
}
