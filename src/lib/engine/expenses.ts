import { addMonths, mlabel } from "./format";
import { shiftWindow, windowFor, type PeriodSel, type Window } from "./period";
import type { ClassKey, Comparison } from "./types";
import { isBillDoc } from "./series";
import { monthLabel } from "@/lib/i18n";

const WORD_AR: Record<string, string> = { "the same period last year": "نفس الفترة من العام الماضي", "last month": "الشهر السابق", "the prior quarter": "الربع السابق", "the prior year": "السنة السابقة" };

/**
 * Expenses analysis: what the company spends, on what and with whom, how it changes and how it compares with sales.
 * Accounts (always there once a P&L is loaded) give the totals, which tie to the P&L exactly; expense lines (the General
 * Ledger's cost lines or a purchases file, added up by the database) give suppliers, sources and the entries worth a look.
 */

/** Per month, supplier, series and class. a amount, d documents, n lines. */
export interface ExpenseSupplierRow { p: string; s: string; j: string; c: ClassKey | null; a: number; d: number; n: number }
/** Per month, account (or expense type), category and class. */
export interface ExpenseAccountRow { p: string; t: string; g: string; c: ClassKey | null; a: number; n: number }
/** An entry worth a look: large for its account, or the same supplier and amount twice within a week (d2 / doc2: the second). */
export interface ExpenseFlag { k: "large" | "double"; d: string | null; p: string; doc: string; s: string; t: string; a: number; m?: number; d2?: string | null; doc2?: string }
export interface ExpensesData { suppliers: ExpenseSupplierRow[]; accounts: ExpenseAccountRow[]; sources: Record<string, "ledger" | "file">; flags: ExpenseFlag[] }
export const EMPTY_EXPENSES: ExpensesData = { suppliers: [], accounts: [], sources: {}, flags: [] };

export const NO_SUPPLIER = "No supplier";
export const EXPENSE_JOURNAL = "Journal entries";
export const DEPRECIATION_SUPPLIER = "Depreciation (no payment)";
/** Cost of sales posted by a stock move or a customer invoice: its partner is the customer, never a supplier. */
export const COGS_SUPPLIER = "Cost of goods sold (stock)";
/** Other cost lines on customer invoices (penalties, collection fees): their partner is a customer too. */
export const CUSTOMER_DOCS = "Customer invoices (no supplier)";
/** Paid through CPS, the government payment gateway (customs duties, VAT, taxes): owed to the state, not to a supplier. */
export const GOV_PAYMENTS = "Government payments (CPS)";
/** Paid by company credit card (IT subscriptions, business meals and travel): the books do not name the merchant. */
export const CARD_SPEND = "Company card spending (VISA)";
/** Names that are not a supplier one pays (left out of supplier concentration and of double-payment checks). */
export const NOT_SUPPLIERS = new Set(["", NO_SUPPLIER, EXPENSE_JOURNAL, DEPRECIATION_SUPPLIER, COGS_SUPPLIER, CUSTOMER_DOCS, GOV_PAYMENTS, CARD_SPEND]);
/**
 * Interest and bank charges are owed to a bank that lends to the company or keeps its accounts, never to a supplier: their
 * lines carry the bank ("Bank: CIB"), and the Expenses pages list banks apart from suppliers.
 */
export const LENDER_TAG = "Bank: ";
export const UNNAMED_LENDER = `${LENDER_TAG}(not named)`;
export const isLender = (s: string) => s.startsWith(LENDER_TAG);
/** "Bank: CIB" → "CIB"; a line whose entry names no bank → "Bank not named". */
export const lenderName = (s: string) => (s === UNNAMED_LENDER ? "Bank not named" : s.slice(LENDER_TAG.length));
/** Not a supplier the company buys from: the names above, and banks. */
export const notSupplier = (s: string) => NOT_SUPPLIERS.has(s) || isLender(s);
const DEPRECIATION = new Set<string>(["cos_depreciation", "exp_depreciation"]);

type Line = { day: string | null; period: string; doc: string; series: string; supplier: string; account: string; cls: ClassKey | null; category: string; amount: number };

/** The flags the database finds (migration 0009), from lines: the demo company and the tests use the same rules. */
export function expenseFlags(lines: (Line & { source?: "ledger" | "file" })[]): ExpenseFlag[] {
  const monthTotal = new Map<string, number>(), acctMonth = new Map<string, Map<string, number>>();
  for (const l of lines) {
    if (!isCostLine(l.cls)) continue;
    monthTotal.set(l.period, (monthTotal.get(l.period) ?? 0) + l.amount);
    if (DEPRECIATION.has(l.cls ?? "")) continue;
    const m = acctMonth.get(l.account) ?? acctMonth.set(l.account, new Map()).get(l.account)!;
    m.set(l.period, (m.get(l.period) ?? 0) + l.amount);
  }
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length / 2; return s.length % 2 ? s[Math.floor(m)] : (s[m - 1] + s[m]) / 2; };
  const typical = new Map([...acctMonth].map(([k, m]) => { const xs = [...m.values()].filter((v) => v > 0); return [k, { med: xs.length ? median(xs) : 0, n: xs.length }]; }));
  const order = (a: { a: number; d: string | null; doc: string }, b: { a: number; d: string | null; doc: string }) => b.a - a.a || (a.d ?? "").localeCompare(b.d ?? "") || a.doc.localeCompare(b.doc);
  // Large: one entry bigger than twice the account's usual month, on an account with 4+ months of costs, 2%+ of the month.
  const large: ExpenseFlag[] = lines.filter((l) => {
    const t = typical.get(l.account);
    return !!t && isCostLine(l.cls) && t.n >= 4 && l.amount > 2 * t.med && l.amount >= 0.02 * (monthTotal.get(l.period) ?? 0) && !DEPRECIATION.has(l.cls ?? "");
  }).map((l) => ({ k: "large" as const, d: l.day, p: l.period, doc: l.doc, s: l.supplier, t: l.account, a: l.amount, m: Math.round(typical.get(l.account)!.med * 100) / 100 })).sort(order).slice(0, 100);
  // Double: same supplier and amount on two bills within 7 days, an amount seen only those two times within 30 days.
  const bills = lines.filter((l) => l.day && l.amount > 0 && !notSupplier(l.supplier) && !DEPRECIATION.has(l.cls ?? "") && (l.source === "file" || isBillDoc(l.doc)));
  const days = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / 86400000;
  const doubles: ExpenseFlag[] = [];
  for (let x = 0; x < bills.length; x++) for (let y = x + 1; y < bills.length; y++) {
    const a = bills[x], b = bills[y];
    if (a.supplier !== b.supplier || a.amount !== b.amount || days(a.day!, b.day!) > 7 || (a.doc === b.doc && a.doc !== "")) continue;
    if (a.amount < 0.0005 * (monthTotal.get(a.period) ?? 0)) continue;
    if (bills.filter((z) => z.supplier === a.supplier && z.amount === a.amount && days(z.day!, a.day!) <= 30).length !== 2) continue;
    doubles.push({ k: "double", d: a.day, p: a.period, doc: a.doc, s: a.supplier, t: a.account, a: a.amount, d2: b.day, doc2: b.doc });
  }
  return [...large, ...doubles.sort(order).slice(0, 100)];
}

/** The same summary the database builds, from lines (used for the demo company and in tests). */
export function summariseExpenses(lines: Line[], source: "ledger" | "file" = "ledger"): ExpensesData {
  const sm = new Map<string, ExpenseSupplierRow & { docs: Set<string> }>(), am = new Map<string, ExpenseAccountRow>();
  for (const l of lines) {
    const sk = [l.period, l.supplier, l.series, l.cls].join("\u0001");
    const s = sm.get(sk) ?? { p: l.period, s: l.supplier, j: l.series, c: l.cls, a: 0, d: 0, n: 0, docs: new Set<string>() };
    s.a += l.amount; s.n++;
    if (l.doc) s.docs.add(l.doc);
    sm.set(sk, s);
    const ak = [l.period, l.account, l.category, l.cls].join("\u0001");
    const a = am.get(ak) ?? { p: l.period, t: l.account, g: l.category, c: l.cls, a: 0, n: 0 };
    a.a += l.amount; a.n++;
    am.set(ak, a);
  }
  return {
    suppliers: [...sm.values()].map(({ docs, ...s }) => ({ ...s, d: docs.size })), accounts: [...am.values()],
    sources: Object.fromEntries([...new Set(lines.map((l) => l.period))].map((p) => [p, source])),
    flags: expenseFlags(lines.map((l) => ({ ...l, source }))),
  };
}

export const expenseMonths = (d: ExpensesData) => [...new Set([...d.suppliers.map((r) => r.p), ...d.accounts.map((r) => r.p)])].sort();

// ---------------------------------------------------------------- analysis

/** The groups costs are shown in, in P&L order. */
/** What expense lines must add up to each month: every group below (spec R4.1, said word for word wherever the tie is shown). */
export const COSTS_DEFINITION = "P&L costs = cost of sales + expenses (variable, fixed, depreciation and amortisation) + other expenses + interest + tax.";
export const EXPENSE_GROUPS: { key: string; name: string; classes: ClassKey[] }[] = [
  { key: "cos", name: "Cost of sales", classes: ["cos_variable", "cos_fixed"] },
  { key: "fixed", name: "Running costs (fixed)", classes: ["exp_fixed"] },
  { key: "variable", name: "Selling costs (variable)", classes: ["exp_variable"] },
  { key: "depreciation", name: "Depreciation", classes: ["cos_depreciation", "exp_depreciation"] },
  { key: "finance", name: "Interest and tax", classes: ["interest_expenses", "tax_expenses"] },
  { key: "other", name: "Other costs", classes: ["other_expenses", "adjustments"] },
];
const GROUP_OF = new Map(EXPENSE_GROUPS.flatMap((g) => g.classes.map((c) => [c, g] as const)));
export const isExpenseClass = (c: string) => GROUP_OF.has(c as ClassKey);
/** A line that is a cost (a P&L cost class, or a file line with no class), not goods bought for stock. */
export const isCostLine = (c: ClassKey | string | null) => c === null || c === "" || isExpenseClass(c);
const VARIABLE = new Set<string>(["cos_variable", "exp_variable"]), FIXED = new Set<string>(["cos_fixed", "exp_fixed"]);

/** Where lines came from, by their document series. */
export function sourceName(series: string) {
  const s = series.toUpperCase();
  return s === "BILL" ? "Vendor bills" : s === "RBILL" ? "Supplier refunds" : s === "EXP" ? "Expense reports" : s === "STJ" ? "Stock moves" : s === "MISC" ? "Journal entries"
    : s === "ASSTE" ? "Depreciation" : s === "SAL" || s === "SLIP" ? "Payroll" : s === "CPS" ? GOV_PAYMENTS : s === "VISA" ? "Company cards (VISA)" : s ? `${series} journal` : "Other";
}

/** An account as the company holds it: monthly amounts in natural sign (costs positive). */
export interface ExpenseAccount { id: string; code: string; name: string; cls: ClassKey; amounts: Record<string, number> }

export interface ExpenseRow {
  key: string; name: string; group?: string; cls?: ClassKey | null;
  amount: number; share: number; compare: number | null; growth: number | null;
  /** Amount as a % of sales in the window. */
  ofSales: number | null;
  /** Accounts: months of the window with an amount, whether it recurs (75%+ of months) and the amount per window month. */
  months?: number; recurring?: boolean; spark?: number[];
  /** Suppliers: documents, the average one, and whether they were not paid in the 12 months before the window. */
  docs?: number; avg?: number | null; isNew?: boolean;
  /** Suppliers: of the amount, goods bought for stock (they reach costs as cost of sales when sold). */
  stock?: number;
}
export interface ExpenseFinding { kind: "risk" | "watch" | "win"; title: string; text: string }
/** A bank the company pays interest or charges to, in the window (and the comparison when there is one). */
export interface LenderRow { key: string; name: string; interest: number; fees: number; amount: number; share: number; compare: number | null; growth: number | null; ofSales: number | null }

export interface ExpensesAnalysis {
  window: Window;
  compareLabel: string;
  /** Window months that have a P&L. */
  months: string[];
  total: number;
  compare: number | null;
  growth: number | null;
  revenue: number | null;
  /** Costs as a % of sales, this window and the comparison. */
  ofSales: number | null;
  ofSalesCompare: number | null;
  split: { fixed: number; variable: number; depreciation: number; other: number };
  byGroup: ExpenseRow[];
  byAccount: ExpenseRow[];
  /** The change against the comparison by account: the largest movers, the rest together; adds up to total − compare. */
  bridge: { name: string; delta: number }[];
  /** Lines (suppliers): whether any are loaded for the window, their total and the share of costs they cover. */
  lines: { has: boolean; total: number; coverage: number | null; months: string[] };
  /** Who was paid: costs plus goods bought for stock (banks are listed apart, in byLender). */
  bySupplier: ExpenseRow[];
  /** Banks: interest and bank charges per bank, largest first. */
  byLender: LenderRow[];
  /** Interest and bank charges paid to banks in the window. */
  finance: { interest: number; fees: number; total: number; compare: number | null };
  /** Partners that are also customers in the sales data: shown for a check, not as suppliers. */
  alsoCustomers: ExpenseRow[];
  /** Goods bought for stock from the suppliers above in the period (not in the cost totals). */
  stockBought: number;
  bySource: ExpenseRow[];
  byCategory: ExpenseRow[];
  concentration: { suppliers: number; topName: string | null; topShare: number | null; top5Share: number | null; newCount: number | null };
  /** The 24 months to the window end. */
  trend: { period: string; total: number | null; groups: Record<string, number>; revenue: number | null; ofSales: number | null; lines: number | null }[];
  /** Window months where the lines and the P&L costs differ by more than 0.5%. */
  unreconciled: { period: string; lines: number; costs: number; diff: number }[];
  /** False when no P&L is loaded: the lines cannot be checked against one ("Not checked", never "agree"). */
  reconcilable: boolean;
  large: ExpenseFlag[];
  doubles: ExpenseFlag[];
  findings: ExpenseFinding[];
  notes: string[];
}

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
const pctOf = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const growthOf = (a: number, b: number | null) => (b === null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
const round2 = (v: number) => Math.round(v * 100) / 100;

function rank<R extends { p: string; a: number }>(rows: R[], cur: Set<string>, cmp: Set<string> | null, key: (r: R) => string, name: (r: R) => string, revenue: number | null, extra?: (r: R) => { group?: string; cls?: ClassKey | null }): ExpenseRow[] {
  const m = new Map<string, ExpenseRow & { cmpAmt: number; seen: boolean }>();
  for (const r of rows) {
    const inCur = cur.has(r.p), inCmp = cmp?.has(r.p) ?? false;
    if (!inCur && !inCmp) continue;
    const k = key(r);
    const x = m.get(k) ?? { key: k, name: name(r), ...extra?.(r), amount: 0, share: 0, compare: null, growth: null, ofSales: null, cmpAmt: 0, seen: false };
    if (inCur) { x.amount += r.a; x.seen = true; }
    if (inCmp) x.cmpAmt += r.a;
    m.set(k, x);
  }
  const total = sum([...m.values()], (x) => x.amount);
  return [...m.values()].filter((x) => x.seen || x.cmpAmt).map(({ cmpAmt, seen, ...x }) => {
    void seen;
    const compare = cmp ? cmpAmt : null;
    return { ...x, share: pctOf(x.amount, total), compare, growth: growthOf(x.amount, compare), ofSales: revenue ? (x.amount / revenue) * 100 : null };
  }).sort((a, b) => b.amount - a.amount);
}

export function expensesAnalysis(
  accounts: ExpenseAccount[], d: ExpensesData, sel: PeriodSel, fyStart: number,
  opts: { comparison?: Comparison; revenue?: Record<string, number>; customers?: Set<string>; lang?: "en" | "ar"; fromLines?: boolean } = {},
): ExpensesAnalysis {
  const ar = opts.lang === "ar";
  const L = (en: string, a: string) => (ar ? a : en);
  const ml = (p: string) => (ar ? monthLabel(p, "ar") : mlabel(p));
  const window = windowFor(sel, fyStart);
  const shift = opts.comparison === "ly" ? 12 : sel.type === "month" ? 1 : sel.type === "quarter" ? 3 : 12;
  const cmpW = shiftWindow(window, shift);
  const costs = accounts.filter((a) => isExpenseClass(a.cls));
  // Months with a P&L: any P&L account with an amount (a month of revenue and no costs still counts).
  const held = new Set<string>();
  for (const a of accounts) if (isExpenseClass(a.cls) || a.cls === "revenue") for (const [p, v] of Object.entries(a.amounts)) if (v) held.add(p);
  const cur = new Set(window.periods);
  const cmpOk = cmpW.periods.every((p) => held.has(p));
  const cmp = cmpOk ? new Set(cmpW.periods) : null;
  const months = window.periods.filter((p) => held.has(p));
  const rev = (ps: Iterable<string>) => { let s = 0, any = false; for (const p of ps) { const v = opts.revenue?.[p]; if (v !== undefined) { s += v; any = true; } } return any ? s : null; };
  const revenue = rev(window.periods), revenueCmp = cmp ? rev(cmp) : null;

  // ---- accounts (tie to the P&L)
  const acctRows = costs.flatMap((a) => Object.entries(a.amounts).map(([p, v]) => ({ p, a: v, acct: a })));
  const total = sum(acctRows.filter((r) => cur.has(r.p)), (r) => r.a);
  const compare = cmp ? sum(acctRows.filter((r) => cmp.has(r.p)), (r) => r.a) : null;
  const byAccount = rank(acctRows, cur, cmp, (r) => r.acct.id, (r) => [r.acct.code, r.acct.name].filter(Boolean).join(" "), revenue, (r) => ({ group: GROUP_OF.get(r.acct.cls)!.name, cls: r.acct.cls }))
    .filter((r) => r.amount || r.compare);
  const last12 = Array.from({ length: 12 }, (_, i) => addMonths(window.end, i - 11));
  for (const r of byAccount) {
    const a = costs.find((x) => x.id === r.key)!;
    r.spark = window.periods.map((p) => a.amounts[p] ?? 0);
    r.months = months.filter((p) => a.amounts[p]).length;
    // Recurring or one-off is judged over the twelve months to the period's end (a one-month view says nothing on its
    // own), on the months the books hold; with under three months there is no judgement.
    const year = last12.filter((p) => held.has(p));
    const used = year.filter((p) => a.amounts[p]).length;
    r.recurring = year.length >= 3 ? used >= Math.ceil(year.length * 0.75) : undefined;
  }
  const byGroup = rank(acctRows, cur, cmp, (r) => GROUP_OF.get(r.acct.cls)!.key, (r) => GROUP_OF.get(r.acct.cls)!.name, revenue);
  byGroup.sort((a, b) => EXPENSE_GROUPS.findIndex((g) => g.key === a.key) - EXPENSE_GROUPS.findIndex((g) => g.key === b.key));
  const split = { fixed: 0, variable: 0, depreciation: 0, other: 0 };
  for (const r of acctRows) if (cur.has(r.p)) {
    const c = r.acct.cls;
    if (VARIABLE.has(c)) split.variable += r.a; else if (FIXED.has(c)) split.fixed += r.a; else if (DEPRECIATION.has(c)) split.depreciation += r.a; else split.other += r.a;
  }
  let bridge: ExpensesAnalysis["bridge"] = [];
  if (compare !== null) {
    const moves = byAccount.map((r) => ({ name: r.name, delta: round2(r.amount - (r.compare ?? 0)) })).filter((m) => m.delta).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const top = moves.slice(0, 6);
    const rest = round2(total - compare - sum(top, (m) => m.delta));
    bridge = [...top, ...(Math.abs(rest) >= 0.01 ? [{ name: L(`${moves.length - top.length} other accounts`, `حسابات أخرى: ${moves.length - top.length}`), delta: rest }] : [])];
  }

  // ---- lines (suppliers, sources, categories)
  const lineMonths = expenseMonths(d);
  const lineHeld = new Set(lineMonths);
  const lineCur = window.periods.filter((p) => lineHeld.has(p));
  const lineCmpOk = cmpW.periods.every((p) => lineHeld.has(p));
  const lcmp = lineCmpOk ? new Set(cmpW.periods) : null;
  // Costs come from cost lines only; goods bought for stock count under their supplier, never in costs.
  const costSup = d.suppliers.filter((r) => isCostLine(r.c));
  const linesTotal = sum(costSup.filter((r) => cur.has(r.p)), (r) => r.a);
  const allSuppliers = rank(d.suppliers, cur, lcmp, (r) => r.s || "No supplier", (r) => r.s || "No supplier", revenue);
  const stockBy = new Map<string, number>();
  for (const r of d.suppliers) if (cur.has(r.p) && !isCostLine(r.c)) stockBy.set(r.s, (stockBy.get(r.s) ?? 0) + r.a);
  for (const r of allSuppliers) r.stock = stockBy.get(r.key) ?? 0;
  // A partner who also buys from the company is checked, not ranked as a supplier: it may be a customer on a cost line.
  const customers = opts.customers ?? new Set<string>();
  const alsoCustomers = allSuppliers.filter((r) => customers.has(r.key) && !notSupplier(r.key) && r.amount);
  const bySupplier = allSuppliers.filter((r) => !alsoCustomers.includes(r) && !isLender(r.key));
  // Banks: interest and charges per bank (lines tagged when read), with the comparison when the lines cover it.
  const lm = new Map<string, LenderRow & { seen: boolean }>();
  for (const r of costSup) {
    if (!isLender(r.s)) continue;
    const inCur = cur.has(r.p), inCmp = lcmp?.has(r.p) ?? false;
    if (!inCur && !inCmp) continue;
    const x = lm.get(r.s) ?? { key: r.s, name: lenderName(r.s), interest: 0, fees: 0, amount: 0, share: 0, compare: lcmp ? 0 : null, growth: null, ofSales: null, seen: false };
    if (inCur) { x.amount += r.a; x.seen = true; if (r.c === "interest_expenses") x.interest += r.a; else x.fees += r.a; }
    if (inCmp && x.compare !== null) x.compare += r.a;
    lm.set(r.s, x);
  }
  const lenderTotal = sum([...lm.values()], (x) => x.amount);
  const byLender: LenderRow[] = [...lm.values()].filter((x) => x.seen || x.compare).map(({ seen, ...x }) => {
    void seen;
    return { ...x, share: pctOf(x.amount, lenderTotal), growth: growthOf(x.amount, x.compare), ofSales: revenue ? (x.amount / revenue) * 100 : null };
  }).sort((a, b) => b.amount - a.amount);
  const finance = { interest: sum(byLender, (x) => x.interest), fees: sum(byLender, (x) => x.fees), total: lenderTotal, compare: lcmp ? sum(byLender, (x) => x.compare ?? 0) : null };
  const docs = new Map<string, number>();
  for (const r of d.suppliers) if (cur.has(r.p)) docs.set(r.s, (docs.get(r.s) ?? 0) + r.d);
  // "New" needs history: lines for at least three months before the window, so a first payment really is a first.
  const firstLine = lineMonths[0];
  const history = !!firstLine && firstLine <= addMonths(window.start, -3);
  const before = new Set(Array.from({ length: 12 }, (_, i) => addMonths(window.start, -12 + i)));
  const paidBefore = new Set(d.suppliers.filter((r) => before.has(r.p) && r.a > 0).map((r) => r.s));
  for (const r of bySupplier) {
    r.docs = docs.get(r.key) ?? 0;
    r.avg = r.docs ? r.amount / r.docs : null;
    r.isNew = history && !notSupplier(r.key) && r.amount > 0 && !paidBefore.has(r.key);
  }
  const named = bySupplier.filter((r) => !notSupplier(r.key) && r.amount > 0);
  const namedTotal = sum(named, (r) => r.amount);
  const bySource = rank(costSup, cur, lcmp, (r) => sourceName(r.j), (r) => sourceName(r.j), revenue);
  const byCategory = rank(d.accounts.filter((r) => isCostLine(r.c)), cur, lcmp, (r) => r.g || "No category", (r) => r.g || "No category", revenue);

  // ---- trend and reconciliation
  const costHeld = new Set(costSup.map((r) => r.p));
  const trend = Array.from({ length: 24 }, (_, i) => addMonths(window.end, -23 + i)).map((p) => {
    const has = held.has(p);
    const groups: Record<string, number> = {};
    let t = 0;
    if (has) for (const r of acctRows) if (r.p === p) { const g = GROUP_OF.get(r.acct.cls)!.key; groups[g] = (groups[g] ?? 0) + r.a; t += r.a; }
    const rv = opts.revenue?.[p] ?? null;
    // With no P&L the "P&L" is the lines themselves (accountsFromLines): there is nothing to check them against.
    return { period: p, total: has ? t : null, groups, revenue: rv, ofSales: has && rv ? (t / rv) * 100 : null, lines: !opts.fromLines && costHeld.has(p) ? sum(costSup.filter((r) => r.p === p), (r) => r.a) : null };
  });
  const unreconciled = trend.filter((t) => cur.has(t.period) && t.lines !== null && t.total !== null && Math.abs(t.lines - t.total) > Math.max(1, Math.abs(t.total) * 0.005))
    .map((t) => ({ period: t.period, lines: t.lines!, costs: t.total!, diff: t.lines! - t.total! }));
  const large = d.flags.filter((f) => f.k === "large" && cur.has(f.p));
  const doubles = d.flags.filter((f) => f.k === "double" && cur.has(f.p));

  // ---- findings
  const findings: ExpenseFinding[] = [];
  const g = growthOf(total, compare);
  const ofSales = revenue ? (total / revenue) * 100 : null, ofSalesCompare = revenueCmp && compare !== null ? (compare / revenueCmp) * 100 : null;
  const word = opts.comparison === "ly" ? "the same period last year" : sel.type === "month" ? "last month" : sel.type === "quarter" ? "the prior quarter" : "the prior year";
  const wordA = WORD_AR[word] ?? word;
  const lead = bridge.filter((b) => !/other accounts$|^حسابات أخرى/.test(b.name))[0];
  if (g !== null && Math.abs(g) >= 5) findings.push({ kind: g > 0 ? "watch" : "win", title: L(`Costs ${g > 0 ? "up" : "down"} ${Math.abs(g).toFixed(1)}% on ${word}`, `التكاليف ${g > 0 ? "ارتفعت" : "انخفضت"} ${Math.abs(g).toFixed(1)}% عن ${wordA}`), text: lead ? L(`The biggest change: ${lead.name} (${fmtSigned(lead.delta)}).`, `أكبر تغير: ${lead.name} (${fmtSigned(lead.delta)}).`) : L("See the accounts below for what moved.", "راجع الحسابات أدناه لمعرفة ما تغير.") });
  if (ofSales !== null && ofSalesCompare !== null && ofSales - ofSalesCompare >= 2) findings.push({ kind: "risk", title: L(`Costs grew faster than sales`, "التكاليف نمت أسرع من المبيعات"), text: L(`Costs take ${ofSales.toFixed(1)}% of sales, up from ${ofSalesCompare.toFixed(1)}%. Each 1 point is about ${fmtSigned(revenue! / 100)} of profit.`, `التكاليف تستهلك ${ofSales.toFixed(1)}% من المبيعات، بعد أن كانت ${ofSalesCompare.toFixed(1)}%. كل نقطة تساوي نحو ${fmtSigned(revenue! / 100)} من الربح.`) });
  else if (ofSales !== null && ofSalesCompare !== null && ofSalesCompare - ofSales >= 2) findings.push({ kind: "win", title: L(`Costs take a smaller part of sales`, "التكاليف تستهلك جزءًا أصغر من المبيعات"), text: L(`${ofSales.toFixed(1)}% of sales, down from ${ofSalesCompare.toFixed(1)}%.`, `${ofSales.toFixed(1)}% من المبيعات، بعد أن كانت ${ofSalesCompare.toFixed(1)}%.`) });
  const mover = byAccount.filter((r) => r.compare !== null && r.growth !== null && Math.abs(r.amount - r.compare) >= Math.max(Math.abs(total) * 0.03, 1)).sort((a, b) => Math.abs(b.amount - b.compare!) - Math.abs(a.amount - a.compare!))[0];
  if (mover && mover.name !== lead?.name) findings.push({ kind: mover.amount > mover.compare! ? "watch" : "win", title: L(`${mover.name} ${mover.amount > mover.compare! ? "rose" : "fell"} ${Math.abs(mover.growth!).toFixed(0)}%`, `${mover.name} ${mover.amount > mover.compare! ? "ارتفع" : "انخفض"} ${Math.abs(mover.growth!).toFixed(0)}%`), text: L(`${fmtSigned(mover.amount - mover.compare!)} against ${word}.`, `${fmtSigned(mover.amount - mover.compare!)} مقارنة بـ${wordA}.`) });
  const top = named[0];
  const top5 = sum(named.slice(0, 5), (r) => r.amount);
  if (top && namedTotal > 0 && top.amount / namedTotal > 0.25) findings.push({ kind: "watch", title: L(`One supplier takes ${Math.round((top.amount / namedTotal) * 100)}% of spend`, `مورد واحد يستحوذ على ${Math.round((top.amount / namedTotal) * 100)}% من الإنفاق`), text: L(`${top.name}. A price rise or a delay there would hit costs and stock. Is there a second supplier?`, `${top.name}. أي زيادة في السعر أو تأخير هناك سيؤثر على التكاليف والمخزون. هل يوجد مورد بديل؟`) });
  else if (named.length >= 8 && namedTotal > 0 && top5 / namedTotal > 0.6) findings.push({ kind: "watch", title: L(`Five suppliers take ${Math.round((top5 / namedTotal) * 100)}% of spend`, `خمسة موردين يستحوذون على ${Math.round((top5 / namedTotal) * 100)}% من الإنفاق`), text: L("Spend sits with a small group of suppliers: worth checking prices against others once a year.", "الإنفاق مركّز لدى مجموعة صغيرة من الموردين: يستحسن مقارنة الأسعار بغيرهم مرة في السنة.") });
  if (doubles.length) findings.push({ kind: "risk", title: L(`${doubles.length} possible double payment${doubles.length > 1 ? "s" : ""}`, `دفعات قد تكون مكررة: ${doubles.length}`), text: L(`Same supplier and amount within a week. ${doubles.slice(0, 2).map((f) => `${f.s}: ${f.doc || "no number"} and ${f.doc2 || "no number"}`).join("; ")}. Check them in Odoo.`, `نفس المورد ونفس المبلغ خلال أسبوع. ${doubles.slice(0, 2).map((f) => `${f.s}: ${f.doc || "بلا رقم"} و${f.doc2 || "بلا رقم"}`).join("؛ ")}. راجعها في Odoo.`) });
  if (large.length) findings.push({ kind: "watch", title: L(`${large.length} unusually large entr${large.length > 1 ? "ies" : "y"}`, `قيود كبيرة على غير المعتاد: ${large.length}`), text: L(`Each is bigger than twice the account's usual month. ${large.slice(0, 2).map((f) => `${f.t}: ${fmtSigned(f.a)}`).join("; ")}.`, `كل منها أكبر من ضعف الشهر المعتاد للحساب. ${large.slice(0, 2).map((f) => `${f.t}: ${fmtSigned(f.a)}`).join("؛ ")}.`) });
  if (finance.total > 0 && revenue && (finance.total / revenue) * 100 >= 3) {
    const big = byLender[0];
    findings.push({ kind: (finance.total / revenue) * 100 >= 6 ? "risk" : "watch", title: L(`Banks take ${((finance.total / revenue) * 100).toFixed(1)}% of sales`, `البنوك تستهلك ${((finance.total / revenue) * 100).toFixed(1)}% من المبيعات`), text: L(`${fmtAmt(finance.interest)} of interest and ${fmtAmt(finance.fees)} of bank charges${big && big.share >= 50 ? `; most of it to ${big.name}` : ""}. Worth comparing rates and fees with other banks.`, `${fmtAmt(finance.interest)} فوائد و${fmtAmt(finance.fees)} مصاريف بنكية${big && big.share >= 50 ? `؛ معظمها لـ ${big.name === "Bank not named" ? "بنك غير محدد" : big.name}` : ""}. يستحسن مقارنة الأسعار والرسوم مع بنوك أخرى.`) });
  }
  if (alsoCustomers.length) findings.push({ kind: "watch", title: L(`${alsoCustomers.length} partner${alsoCustomers.length > 1 ? "s are" : " is"} also ${alsoCustomers.length > 1 ? "customers" : "a customer"}`, `شركاء هم عملاء أيضًا: ${alsoCustomers.length}`), text: L(`${alsoCustomers.slice(0, 3).map((r) => r.name).join(", ")}. Their cost lines are listed apart from suppliers: check they are real purchases, not cost of goods sold to them.`, `${alsoCustomers.slice(0, 3).map((r) => r.name).join("، ")}. بنود تكاليفهم معروضة بعيدًا عن الموردين: تأكد أنها مشتريات حقيقية وليست تكلفة بضاعة مباعة لهم.`) });
  if (unreconciled.length) findings.push({ kind: "watch", title: L(`Lines differ from P&L costs in ${unreconciled.length} month${unreconciled.length > 1 ? "s" : ""}`, `البنود تختلف عن تكاليف قائمة الدخل في عدد من الأشهر: ${unreconciled.length}`), text: L(`${unreconciled.slice(0, 3).map((u) => `${mlabel(u.period)}: ${fmtSigned(u.diff)}`).join("; ")}. A purchases file only holds bills: salaries, rent paid by bank and depreciation are not in it.`, `${unreconciled.slice(0, 3).map((u) => `${ml(u.period)}: ${fmtSigned(u.diff)}`).join("؛ ")}. ملف المشتريات يحتوي الفواتير فقط: الرواتب والإيجار المدفوع بالبنك والإهلاك ليست فيه.`) });

  const notes: string[] = [];
  if (!cmpOk) notes.push(L(`No P&L loaded for ${cmpW.periods.length === 1 ? mlabel(cmpW.periods[0]) : `${mlabel(cmpW.periods[0])} – ${mlabel(cmpW.periods[cmpW.periods.length - 1])}`}, so there is no comparison.`, `لا توجد قائمة دخل محمّلة لـ ${cmpW.periods.length === 1 ? ml(cmpW.periods[0]) : `${ml(cmpW.periods[0])} – ${ml(cmpW.periods[cmpW.periods.length - 1])}`}، لذلك لا توجد مقارنة.`));
  if (!lineCur.length) notes.push(L("Suppliers need expense lines: upload your General Ledger, or your vendor bills.", "معرفة الموردين تحتاج بنود المصروفات: ارفع دفتر الأستاذ العام أو فواتير الموردين."));
  else if (lineCur.length < months.length) notes.push(L(`Expense lines cover ${lineCur.length} of the ${months.length} months.`, `بنود المصروفات تغطي ${lineCur.length} من ${months.length} أشهر.`));

  return {
    window, compareLabel: cmpOk ? word : "", months, total, compare, growth: g, revenue, ofSales, ofSalesCompare, split, byGroup, byAccount, bridge,
    lines: { has: lineCur.length > 0, total: linesTotal, coverage: lineCur.length && total ? (linesTotal / total) * 100 : null, months: lineCur },
    bySupplier, byLender, finance, alsoCustomers, stockBought: sum(bySupplier, (r) => r.stock ?? 0), bySource, byCategory,
    concentration: { suppliers: named.length, topName: top?.name ?? null, topShare: top && namedTotal ? (top.amount / namedTotal) * 100 : null, top5Share: namedTotal ? (top5 / namedTotal) * 100 : null, newCount: history ? bySupplier.filter((r) => r.isNew).length : null },
    trend, unreconciled, reconcilable: !opts.fromLines, large, doubles, findings, notes,
  };
}

const fmtAmt = (v: number) => Math.round(Math.abs(v)).toLocaleString("en-US");
const fmtSigned = (v: number) => `${v >= 0 ? "+" : "−"}${fmtAmt(v)}`;

/** Without a P&L (only an expenses file loaded), the lines' accounts stand in for the P&L's. */
export function accountsFromLines(d: ExpensesData): ExpenseAccount[] {
  const m = new Map<string, ExpenseAccount>();
  for (const r of d.accounts) {
    if (!isCostLine(r.c)) continue;
    const a = m.get(r.t) ?? { id: r.t, code: "", name: r.t, cls: r.c && isExpenseClass(r.c) ? r.c : "exp_fixed", amounts: {} };
    a.amounts[r.p] = (a.amounts[r.p] ?? 0) + r.a;
    m.set(r.t, a);
  }
  return [...m.values()];
}
