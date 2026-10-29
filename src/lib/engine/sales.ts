import { differs } from "@/lib/tolerance";
import { addMonths, mlabel } from "./format";
import { shiftWindow, windowFor, type PeriodSel, type Window } from "./period";
import type { Comparison } from "./types";
import { monthLabel } from "@/lib/i18n";

const WORD_AR: Record<string, string> = { "the same period last year": "نفس الفترة من العام الماضي", "last month": "الشهر السابق", "the prior quarter": "الربع السابق", "the prior year": "السنة السابقة" };

/**
 * Sales analysis from invoice lines added up by customer and by product per month (the shape the database returns).
 * Every total ties to the lines; where the P&L is loaded, sales are reconciled to its revenue month by month.
 */

/** Per month, customer, invoice series and salesperson. a amount, k cost, ka amount with a known cost, q quantity, d invoices, n lines. */
export interface SalesCustomerRow { p: string; c: string; s: string; sp: string; a: number; k: number | null; ka: number | null; q: number | null; d: number; n: number }
/** Per month, product, category and invoice series. */
export interface SalesProductRow { p: string; r: string; g: string; s: string; a: number; k: number | null; ka: number | null; q: number | null; n: number }
export interface SalesData { customers: SalesCustomerRow[]; products: SalesProductRow[]; sources: Record<string, "ledger" | "file"> }

export const EMPTY_SALES: SalesData = { customers: [], products: [], sources: {} };
const NO_CUSTOMER = "No customer";

/** The same summary the database builds, from lines (used for the demo company and in tests). */
export function summariseSales(lines: { period: string; doc: string; series: string; customer: string; product: string; category: string; salesperson: string; qty: number | null; amount: number; cost: number | null }[], source: "ledger" | "file" = "file"): SalesData {
  const cm = new Map<string, SalesCustomerRow & { docs: Set<string> }>(), pm = new Map<string, SalesProductRow>();
  const add = (x: number | null, y: number | null) => (y === null ? x : (x ?? 0) + y);
  for (const l of lines) {
    const ck = [l.period, l.customer, l.series, l.salesperson].join("\u0001");
    const c = cm.get(ck) ?? { p: l.period, c: l.customer, s: l.series, sp: l.salesperson, a: 0, k: null, ka: null, q: null, d: 0, n: 0, docs: new Set<string>() };
    c.a += l.amount; c.k = add(c.k, l.cost); c.ka = l.cost === null ? c.ka : (c.ka ?? 0) + l.amount; c.q = add(c.q, l.qty); c.n++;
    if (l.doc) c.docs.add(l.doc);
    cm.set(ck, c);
    const pk = [l.period, l.product, l.category, l.series].join("\u0001");
    const p = pm.get(pk) ?? { p: l.period, r: l.product, g: l.category, s: l.series, a: 0, k: null, ka: null, q: null, n: 0 };
    p.a += l.amount; p.k = add(p.k, l.cost); p.ka = l.cost === null ? p.ka : (p.ka ?? 0) + l.amount; p.q = add(p.q, l.qty); p.n++;
    pm.set(pk, p);
  }
  const customers = [...cm.values()].map(({ docs, ...c }) => ({ ...c, d: docs.size }));
  return { customers, products: [...pm.values()], sources: Object.fromEntries([...new Set(lines.map((l) => l.period))].map((p) => [p, source])) };
}

export const salesMonths = (d: SalesData) => [...new Set([...d.customers.map((r) => r.p), ...d.products.map((r) => r.p)])].sort();

export interface SalesRow {
  key: string;
  name: string;
  /** For products: the category. */
  group?: string;
  amount: number;
  share: number;
  compare: number | null;
  growth: number | null;
  qty: number | null;
  /** Gross margin %, when the cost of at least 95% of these sales is known. */
  margin: number | null;
  cost: number | null;
  invoices?: number;
  abc?: "A" | "B" | "C";
}

export interface PriceVolumeMix {
  /** Sales change from selling at different prices (same products, this period's quantities). */
  price: number;
  /** From selling more or fewer units in all, at last period's average price. */
  volume: number;
  /** From selling a different mix of products (dearer or cheaper ones). */
  mix: number;
  /** From products sold in only one of the two periods. */
  newLost: number;
  total: number;
  /** Share of sales (this period) whose quantities are known in both periods. */
  coverage: number;
}

export interface SalesFinding { kind: "risk" | "watch" | "win"; title: string; text: string }

export interface SalesAnalysis {
  window: Window;
  compareLabel: string;
  months: string[];
  total: number;
  compare: number | null;
  growth: number | null;
  invoices: number;
  /** Credit notes (refunds) in the period, counted apart from invoices. */
  creditNotes: number;
  avgInvoice: number | null;
  lines: number;
  customers: { active: number; new: number | null; returning: number | null; lost: number | null; lostNames: string[]; top10Share: number | null; topShare: number | null; topName: string | null };
  byCategory: SalesRow[];
  byProduct: SalesRow[];
  byCustomer: SalesRow[];
  bySalesperson: SalesRow[];
  bySeries: SalesRow[];
  abc: Record<"A" | "B" | "C", { count: number; share: number }>;
  pvm: PriceVolumeMix | null;
  /** Gross margin % across the window when cost is known for at least 95% of sales; null otherwise. */
  margin: number | null;
  costCoverage: number;
  /** The 24 months to the window end: sales, P&L revenue and the difference. */
  trend: { period: string; sales: number | null; revenue: number | null; diff: number | null; categories: Record<string, number> }[];
  topCategories: string[];
  /** Months in the window where sales and P&L revenue differ by more than 0.5%. */
  unreconciled: { period: string; sales: number; revenue: number; diff: number }[];
  findings: SalesFinding[];
  /** Data limits worth saying (no earlier months, no quantities…). */
  notes: string[];
}

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
/** A credit note: Odoo's refund series ("RINV"), or a series that names one, or any series whose lines net negative. */
export const isCreditNote = (r: { s: string; a: number }) => /^R[A-Z]*INV|refund|credit|^CN$/i.test(r.s) || (r.a < 0 && !/INV/i.test(r.s));
const pctOf = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const growthOf = (a: number, b: number | null) => (b === null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100);

/** Rows grouped by a key, with this window's and the comparison window's totals. */
function rank<R extends { p: string; a: number; k: number | null; ka: number | null; q: number | null }>(
  rows: R[], cur: Set<string>, cmp: Set<string> | null, key: (r: R) => string, name: (r: R) => string, group?: (r: R) => string, docs?: (r: R) => number,
): SalesRow[] {
  const m = new Map<string, SalesRow & { costed: number; cmpAmt: number; seen: boolean }>();
  for (const r of rows) {
    const inCur = cur.has(r.p), inCmp = cmp?.has(r.p) ?? false;
    if (!inCur && !inCmp) continue;
    const k = key(r);
    const x = m.get(k) ?? { key: k, name: name(r), group: group?.(r), amount: 0, share: 0, compare: null, growth: null, qty: null, margin: null, cost: null, invoices: docs ? 0 : undefined, costed: 0, cmpAmt: 0, seen: false };
    if (inCur) {
      x.amount += r.a; x.seen = true;
      if (r.q !== null) x.qty = (x.qty ?? 0) + r.q;
      if (r.k !== null) { x.cost = (x.cost ?? 0) + r.k; x.costed += r.ka ?? 0; }
      if (docs) x.invoices! += docs(r);
    }
    if (inCmp) x.cmpAmt += r.a;
    m.set(k, x);
  }
  const total = sum([...m.values()], (x) => x.amount);
  return [...m.values()].filter((x) => x.seen || x.cmpAmt).map(({ costed, cmpAmt, seen, ...x }) => {
    void seen;
    const compare = cmp ? cmpAmt : null;
    const known = x.amount !== 0 && Math.abs(costed) >= Math.abs(x.amount) * 0.95;
    return { ...x, share: pctOf(x.amount, total), compare, growth: growthOf(x.amount, compare), margin: known && x.cost !== null ? ((costed - x.cost) / costed) * 100 : null };
  }).sort((a, b) => b.amount - a.amount);
}

export function salesAnalysis(
  d: SalesData, sel: PeriodSel, fyStart: number,
  opts: { comparison?: Comparison; revenue?: Record<string, number>; categoryOf?: (c: string) => string; lang?: "en" | "ar" } = {},
): SalesAnalysis {
  const ar = opts.lang === "ar";
  const L = (en: string, a: string) => (ar ? a : en);
  const ml = (p: string) => (ar ? monthLabel(p, "ar") : mlabel(p));
  const window = windowFor(sel, fyStart);
  const shift = opts.comparison === "ly" ? 12 : sel.type === "month" ? 1 : sel.type === "quarter" ? 3 : 12;
  const cmpW = shiftWindow(window, shift);
  const held = new Set(salesMonths(d));
  const cur = new Set(window.periods);
  const cmpOk = cmpW.periods.every((p) => held.has(p));
  const cmp = cmpOk ? new Set(cmpW.periods) : null;
  const cat = opts.categoryOf ?? ((g: string) => g);
  const months = window.periods.filter((p) => held.has(p));

  const cRows = d.customers, pRows = d.products;
  const total = sum(cRows.filter((r) => cur.has(r.p)), (r) => r.a);
  const compare = cmp ? sum(cRows.filter((r) => cmp.has(r.p)), (r) => r.a) : null;
  // Credit notes ("RINV/…", or a series whose lines net negative) are counted apart from invoices.
  const inWin = cRows.filter((r) => cur.has(r.p));
  const invoices = sum(inWin.filter((r) => !isCreditNote(r)), (r) => r.d);
  const creditNotes = sum(inWin.filter(isCreditNote), (r) => r.d);
  const invoiced = sum(inWin.filter((r) => !isCreditNote(r)), (r) => r.a);
  const lines = sum(cRows.filter((r) => cur.has(r.p)), (r) => r.n);

  // ---- customers
  const named = (r: SalesCustomerRow) => r.c && r.c !== NO_CUSTOMER;
  const byCust = new Map<string, Map<string, number>>();
  for (const r of cRows) if (named(r)) { const m = byCust.get(r.c) ?? new Map(); m.set(r.p, (m.get(r.p) ?? 0) + r.a); byCust.set(r.c, m); }
  const bought = (c: string, ps: string[]) => ps.some((p) => (byCust.get(c)?.get(p) ?? 0) > 0);
  // Active: any invoice or refund in the period (a customer with only a refund is still a customer of the period).
  const activeSet = [...byCust.keys()].filter((c) => window.periods.some((p) => (byCust.get(c)?.get(p) ?? 0) !== 0));
  const first = [...held][0];
  // "New" needs history: at least three loaded months before the window, so a first purchase really is a first.
  const history = first && first <= addMonths(window.start, -3);
  const newSet = history ? activeSet.filter((c) => ![...byCust.get(c)!.entries()].some(([p, v]) => v > 0 && p < window.start)) : null;
  // "Lost": bought in the 12 months before the last three months to the window end, not since.
  const last3 = Array.from({ length: 3 }, (_, i) => addMonths(window.end, -2 + i));
  const prev12 = Array.from({ length: 12 }, (_, i) => addMonths(window.end, -14 + i));
  const lostOk = first && first <= prev12[0];
  const lostSet = lostOk ? [...byCust.keys()].filter((c) => bought(c, prev12) && !bought(c, last3)) : null;
  const byCustomer = rank(cRows, cur, cmp, (r) => r.c || NO_CUSTOMER, (r) => r.c || NO_CUSTOMER, undefined, (r) => r.d);
  const namedRows = byCustomer.filter((r) => r.key !== NO_CUSTOMER && r.amount > 0);
  const top10 = sum(namedRows.slice(0, 10), (r) => r.amount);

  // ---- products and categories
  const byProduct = rank(pRows, cur, cmp, (r) => `${r.g}\u0001${r.r}`, (r) => r.r, (r) => cat(r.g));
  const byCategory = rank(pRows, cur, cmp, (r) => cat(r.g), (r) => cat(r.g));
  const bySalesperson = rank(cRows.filter((r) => r.sp), cur, cmp, (r) => r.sp, (r) => r.sp);
  const bySeries = rank(cRows.filter((r) => r.s), cur, cmp, (r) => r.s, (r) => r.s);
  const abc: SalesAnalysis["abc"] = { A: { count: 0, share: 0 }, B: { count: 0, share: 0 }, C: { count: 0, share: 0 } };
  const posTotal = sum(byProduct.filter((r) => r.amount > 0), (r) => r.amount);
  let run = 0;
  for (const r of byProduct) {
    if (r.amount <= 0) continue;
    const upTo = run;
    run += r.amount;
    // A: the products making the first 80% of sales; B: the next 15%; C: the rest.
    r.abc = upTo < posTotal * 0.8 ? "A" : upTo < posTotal * 0.95 ? "B" : "C";
    abc[r.abc].count++; abc[r.abc].share += pctOf(r.amount, posTotal);
  }

  // ---- price, volume and mix (products with quantities)
  let pvm: PriceVolumeMix | null = null;
  if (cmp && compare !== null) {
    const qp = (ps: Set<string>) => {
      const m = new Map<string, { a: number; q: number | null }>();
      for (const r of pRows) if (ps.has(r.p)) { const k = `${r.g}\u0001${r.r}`; const x = m.get(k) ?? { a: 0, q: 0 }; x.a += r.a; x.q = r.q === null || x.q === null ? null : x.q + r.q; m.set(k, x); }
      return m;
    };
    const P1 = qp(cur), P0 = qp(cmp);
    const both = [...P1.keys()].filter((k) => P0.has(k) && (P1.get(k)!.q ?? 0) > 0 && (P0.get(k)!.q ?? 0) > 0);
    const covered = sum(both, (k) => P1.get(k)!.a);
    if (both.length && Math.abs(covered) >= Math.abs(total) * 0.5) {
      const R0 = sum(both, (k) => P0.get(k)!.a), Q0 = sum(both, (k) => P0.get(k)!.q!), Q1 = sum(both, (k) => P1.get(k)!.q!);
      const avg0 = R0 / Q0;
      const price = sum(both, (k) => (P1.get(k)!.a / P1.get(k)!.q! - P0.get(k)!.a / P0.get(k)!.q!) * P1.get(k)!.q!);
      const volume = (Q1 - Q0) * avg0;
      const mix = sum(both, (k) => (P0.get(k)!.a / P0.get(k)!.q!) * P1.get(k)!.q!) - Q1 * avg0;
      const total1 = total - compare;
      pvm = { price, volume, mix, newLost: total1 - price - volume - mix, total: total1, coverage: pctOf(covered, total) };
    }
  }

  // ---- margin
  const costed = sum(pRows.filter((r) => cur.has(r.p)), (r) => r.ka ?? 0), cost = sum(pRows.filter((r) => cur.has(r.p)), (r) => r.k ?? 0);
  const costCoverage = pctOf(costed, total);
  const margin = total && Math.abs(costed) >= Math.abs(total) * 0.95 ? ((costed - cost) / costed) * 100 : null;

  // ---- trend and reconciliation
  const topCategories = byCategory.filter((r) => r.amount > 0).slice(0, 5).map((r) => r.key);
  const trend = Array.from({ length: 24 }, (_, i) => addMonths(window.end, -23 + i)).map((p) => {
    const has = held.has(p);
    const s = has ? sum(cRows.filter((r) => r.p === p), (r) => r.a) : null;
    const rev = opts.revenue?.[p] ?? null;
    const categories: Record<string, number> = {};
    if (has) for (const r of pRows) if (r.p === p) { const g = cat(r.g); const k = topCategories.includes(g) ? g : "Other"; categories[k] = (categories[k] ?? 0) + r.a; }
    return { period: p, sales: s, revenue: rev, diff: s !== null && rev !== null ? s - rev : null, categories };
  });
  const unreconciled = trend.filter((t) => cur.has(t.period) && t.sales !== null && t.revenue !== null && differs(t.diff!, 0))
    .map((t) => ({ period: t.period, sales: t.sales!, revenue: t.revenue!, diff: t.diff! }));

  // ---- findings
  const findings: SalesFinding[] = [];
  const g = growthOf(total, compare);
  const word = opts.comparison === "ly" ? "the same period last year" : sel.type === "month" ? "last month" : sel.type === "quarter" ? "the prior quarter" : "the prior year";
  const wordA = WORD_AR[word] ?? word;
  if (g !== null && Math.abs(g) >= 5) findings.push({ kind: g > 0 ? "win" : "risk", title: L(`Sales ${g > 0 ? "up" : "down"} ${Math.abs(g).toFixed(1)}% on ${word}`, `المبيعات ${g > 0 ? "ارتفعت" : "انخفضت"} ${Math.abs(g).toFixed(1)}% عن ${wordA}`), text: pvm ? L(`Price ${fmtSigned(pvm.price)}, volume ${fmtSigned(pvm.volume)}, mix ${fmtSigned(pvm.mix)}, new or dropped products ${fmtSigned(pvm.newLost)}.`, `السعر ${fmtSigned(pvm.price)}، الكمية ${fmtSigned(pvm.volume)}، التشكيلة ${fmtSigned(pvm.mix)}، منتجات جديدة أو متوقفة ${fmtSigned(pvm.newLost)}.`) : L("Look at the categories and customers below to see what drove it.", "راجع الفئات والعملاء أدناه لمعرفة السبب.") });
  const top = namedRows[0];
  if (top && total > 0 && top.amount / total > 0.2) findings.push({ kind: "risk", title: L(`One customer is ${Math.round((top.amount / total) * 100)}% of sales`, `عميل واحد يمثل ${Math.round((top.amount / total) * 100)}% من المبيعات`), text: L(`${top.name}. Losing or delaying this customer would hit revenue and cash hard: banks also look at this.`, `${top.name}. فقدان هذا العميل أو تأخره سيؤثر بشدة على الإيرادات والنقدية: والبنوك تنظر إلى ذلك أيضًا.`) });
  else if (namedRows.length >= 10 && total > 0 && top10 / total > 0.6) findings.push({ kind: "watch", title: L(`Ten customers make ${Math.round((top10 / total) * 100)}% of sales`, `عشرة عملاء يمثلون ${Math.round((top10 / total) * 100)}% من المبيعات`), text: L("Sales depend on a small group of customers.", "المبيعات تعتمد على مجموعة صغيرة من العملاء.") });
  const movers = byCategory.filter((r) => r.growth !== null && r.compare !== null && Math.abs(r.amount - r.compare) >= Math.abs(total) * 0.05).sort((a, b) => Math.abs(b.amount - b.compare!) - Math.abs(a.amount - a.compare!));
  if (movers[0]) findings.push({ kind: movers[0].amount > movers[0].compare! ? "win" : "watch", title: L(`${movers[0].name} ${movers[0].amount > movers[0].compare! ? "grew" : "fell"} ${Math.abs(movers[0].growth!).toFixed(0)}%`, `${movers[0].name} ${movers[0].amount > movers[0].compare! ? "نمت" : "انخفضت"} ${Math.abs(movers[0].growth!).toFixed(0)}%`), text: L(`${fmtSigned(movers[0].amount - movers[0].compare!)} against ${word}: the largest change of any category.`, `${fmtSigned(movers[0].amount - movers[0].compare!)} مقارنة بـ${wordA}: أكبر تغير بين الفئات.`) });
  if (lostSet && lostSet.length) findings.push({ kind: "watch", title: L(`${lostSet.length} customer${lostSet.length > 1 ? "s have" : " has"} not bought for three months`, `عملاء لم يشتروا منذ ثلاثة أشهر: ${lostSet.length}`), text: L(`They bought in the year before. ${lostSet.slice(0, 3).join(", ")}${lostSet.length > 3 ? "…" : ""}`, `اشتروا في السنة السابقة. ${lostSet.slice(0, 3).join("، ")}${lostSet.length > 3 ? "…" : ""}`) });
  if (unreconciled.length) findings.push({ kind: "risk", title: L(`Sales differ from P&L revenue in ${unreconciled.length} month${unreconciled.length > 1 ? "s" : ""}`, `المبيعات تختلف عن إيرادات قائمة الدخل في عدد من الأشهر: ${unreconciled.length}`), text: L(`${unreconciled.slice(0, 3).map((u) => `${mlabel(u.period)}: ${fmtSigned(u.diff)}`).join("; ")}. Revenue posted without an invoice (journal entries) or a sales file covering other dates.`, `${unreconciled.slice(0, 3).map((u) => `${ml(u.period)}: ${fmtSigned(u.diff)}`).join("؛ ")}. إيرادات مسجلة دون فاتورة (قيود يومية) أو ملف مبيعات يغطي تواريخ أخرى.`) });

  const notes: string[] = [];
  if (!cmpOk) notes.push(L(`No sales loaded for ${cmpW.periods.length === 1 ? mlabel(cmpW.periods[0]) : `${mlabel(cmpW.periods[0])} – ${mlabel(cmpW.periods[cmpW.periods.length - 1])}`}, so there is no comparison.`, `لا توجد مبيعات محمّلة لـ ${cmpW.periods.length === 1 ? ml(cmpW.periods[0]) : `${ml(cmpW.periods[0])} – ${ml(cmpW.periods[cmpW.periods.length - 1])}`}، لذلك لا توجد مقارنة.`));
  if (newSet === null) notes.push(L("New customers need at least three months of sales before the period.", "معرفة العملاء الجدد تحتاج ثلاثة أشهر على الأقل من المبيعات قبل الفترة."));
  if (!pvm && cmp) notes.push(L("Price, volume and mix need quantities: upload a sales export with a quantity column.", "تحليل السعر والكمية والتشكيلة يحتاج الكميات: ارفع ملف مبيعات به عمود للكمية."));
  if (margin === null && costCoverage < 95) notes.push(L("Margins need product cost: upload Odoo's Sales or Invoice Analysis with the Margin or Cost column.", "الهوامش تحتاج تكلفة المنتج: ارفع تحليل المبيعات أو الفواتير من Odoo مع عمود الهامش أو التكلفة."));

  return {
    window, compareLabel: cmpOk ? word : "", months, total, compare, growth: g, invoices, creditNotes, avgInvoice: invoices ? invoiced / invoices : null, lines,
    customers: {
      active: activeSet.length, new: newSet?.length ?? null, returning: newSet ? activeSet.length - newSet.length : null,
      lost: lostSet?.length ?? null, lostNames: lostSet?.slice(0, 20) ?? [],
      top10Share: total > 0 && namedRows.length ? (top10 / total) * 100 : null, topShare: top && total > 0 ? (top.amount / total) * 100 : null, topName: top?.name ?? null,
    },
    byCategory, byProduct, byCustomer, bySalesperson, bySeries, abc, pvm, margin, costCoverage, trend, topCategories, unreconciled, findings, notes,
  };
}

const fmtSigned = (v: number) => `${v >= 0 ? "+" : "−"}${Math.round(Math.abs(v)).toLocaleString("en-US")}`;

export const SALES_ACCOUNTS = "Revenue accounts (P&L)";
/**
 * Without invoice lines (a Trial Balance, a P&L, the Odoo balances): the P&L's revenue accounts stand in for products, so
 * the Sales pages still show sales, growth and the trend, tying to revenue exactly. Customers need invoice lines.
 */
export function salesFromAccounts(accounts: { code: string; name: string; cls: string; amounts: Record<string, number> }[]): SalesData {
  const lines = accounts.filter((a) => a.cls === "revenue").flatMap((a) => Object.entries(a.amounts).filter(([, v]) => v).map(([period, amount]) => ({
    period, doc: "", series: "", customer: NO_CUSTOMER, product: [a.code, a.name].filter(Boolean).join(" "), category: SALES_ACCOUNTS, salesperson: "", qty: null, amount, cost: null,
  })));
  return summariseSales(lines, "ledger");
}

/** Everyone the sales data names as a customer (to tell a customer from a supplier on a cost line). */
export const customersOf = (d: SalesData) => new Set(d.customers.filter((r) => r.c && r.c !== NO_CUSTOMER && r.a > 0).map((r) => r.c));
