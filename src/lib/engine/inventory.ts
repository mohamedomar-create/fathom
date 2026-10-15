import type { LayerKind, MoveKind, OnHand, ProductRow } from "@/lib/ingest/inventory";
import { layerKind, isInternalLocation } from "@/lib/ingest/inventory";
import { addMonths, daysIn, mlabel, money } from "./format";
import { windowFor, type PeriodSel } from "./period";
import { tieOut, type TieOut } from "./tieout";
import { COGS_SUPPLIER } from "./expenses";
import { monthLabel, periodLabel } from "@/lib/i18n";

/**
 * The Inventory module: Odoo's valuation layers, done moves and stock on hand, added up by month, product, kind and
 * location in the database. Values are Odoo's own (company currency, incoming positive, outgoing negative).
 */
export type { LayerKind, MoveKind, OnHand, ProductRow };
export const LAYER_KINDS: readonly LayerKind[] = ["receipt", "delivery", "customer_return", "supplier_return", "landed_cost", "adjustment", "scrap", "revaluation", "other"];
export const MOVE_KINDS: readonly MoveKind[] = ["receipt", "delivery", "customer_return", "supplier_return", "internal", "rental_out", "rental_back", "adjustment", "scrap", "manufacturing"];

/** Per month, product and kind: q quantity, v value, n layers. */
export interface LayerRow { p: string; kind: LayerKind; code: string; product: string; category: string; q: number; v: number; n: number }
/** Per month, product, kind and route: q quantity, n move lines. */
export interface MoveRow { p: string; kind: MoveKind; code: string; product: string; from: string; to: string; q: number; n: number }

export interface InventoryData {
  layers: LayerRow[];
  moves: MoveRow[];
  /** Product code → the last day it went out to a customer. */
  lastOut: Record<string, string>;
  /** The latest stock-on-hand snapshot. */
  onhand: OnHand[];
  products: ProductRow[];
  /** The module's value by month and document, and the ledger's, for the records behind a tie-out difference. */
  byRef: { p: string; ref: string; kind: LayerKind; v: number }[];
  ledger: { p: string; ref: string; v: number }[];
  /** Documents of moves to or from the rental location, by month: their value must be 0. */
  rental: { p: string; ref: string }[];
  meta: { withIds: boolean; kinds: string[]; periods: string[] };
}

export const EMPTY_INVENTORY: InventoryData = { layers: [], moves: [], lastOut: {}, onhand: [], products: [], byRef: [], ledger: [], rental: [], meta: { withIds: false, kinds: [], periods: [] } };

// ---------------------------------------------------------------- analysis


export interface ProductStat { code: string; product: string; category: string; value: number; qty: number; cogs: number; days: number | null; turnover: number | null; abc: "A" | "B" | "C"; lastOut: string | null; flag: "slow" | "dead" | null }
export interface InventoryFinding { kind: "risk" | "watch"; title: string; text: string }
export interface InventoryBridge { opening: number; receipts: number; landed: number; deliveries: number; returns: number; adjustments: number; revaluation: number; closing: number }
export interface InventoryAnalysis {
  hasValue: boolean;
  hasMoves: boolean;
  /** The valuation export starts after the first month the accounts hold stock: closing value cannot be checked against them. */
  partialValuation: boolean;
  label: string;
  tiles: { value: number | null; days: number | null; cogs: number | null; slow: number | null; dead: number | null };
  bridge: InventoryBridge | null;
  products: ProductStat[];
  movements: { p: string; kind: MoveKind; q: number }[];
  locations: { loc: string; inQ: number; outQ: number }[];
  tieouts: TieOut[];
  findings: InventoryFinding[];
  headline: string;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const SLOW_DAYS = 90, DEAD_DAYS = 180;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const OUT_KINDS = new Set<LayerKind>(["delivery", "customer_return"]);
const IN_KINDS = new Set<LayerKind>(["receipt", "landed_cost", "supplier_return"]);

/**
 * The Inventory pages for a period: stock value and how it moved, products, movements, findings, and the tie-outs that
 * check every month against the General Ledger.
 *  - ledger.stock: closing balance of the accounts mapped to Inventory, per month (the balance sheet);
 *  - ledger.cogs: cost of sales posted by stock moves, per month (expense lines grouped as "Cost of goods sold (stock)").
 */
export function inventoryAnalysis(
  d: InventoryData, sel: PeriodSel, fyStart: number,
  opts: { ledger: { stock: Record<string, number> | null; cogs: Record<string, number> | null }; revenue?: Record<string, number>; lang?: "en" | "ar"; today?: string; cur?: string },
): InventoryAnalysis {
  const ar = opts.lang === "ar";
  const L = (en: string, a: string) => (ar ? a : en);
  const cur = opts.cur ?? "EGP";
  const fmt = (v: number) => money(r2(v), cur);
  const ml = (p: string) => (ar ? monthLabel(p, "ar") : mlabel(p));
  const window = windowFor(sel, fyStart);
  const periods = window.periods, start = periods[0], end = periods[periods.length - 1];
  const inWin = new Set(periods);
  const label = ar ? periodLabel(window.label, "ar") : window.label;
  const hasValue = d.layers.length > 0, hasMoves = d.moves.length > 0;
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

  // ---- value: closing is every layer up to the month end; the bridge splits the period's layers by kind
  const closingAt = (p: string) => sum(d.layers.filter((l) => l.p <= p), (l) => l.v);
  const win = d.layers.filter((l) => inWin.has(l.p));
  const byKind = (ks: LayerKind[], rows = win) => sum(rows.filter((l) => ks.includes(l.kind)), (l) => l.v);
  const bridge: InventoryBridge | null = hasValue ? {
    opening: r2(sum(d.layers.filter((l) => l.p < start), (l) => l.v)),
    receipts: r2(byKind(["receipt"])), landed: r2(byKind(["landed_cost"])), deliveries: r2(byKind(["delivery"])),
    returns: r2(byKind(["customer_return", "supplier_return"])), adjustments: r2(byKind(["adjustment", "scrap", "other"])), revaluation: r2(byKind(["revaluation"])),
    closing: r2(closingAt(end)),
  } : null;
  const cogs = hasValue ? r2(-byKind(["delivery", "customer_return"])) : null;
  const daysWin = sum(periods, daysIn);
  const value = bridge ? bridge.closing : null;

  // ---- products
  const today = opts.today ?? `${end}-${String(daysIn(end)).padStart(2, "0")}`;
  const codes = [...new Set(d.layers.filter((l) => l.p <= end).map((l) => l.code))];
  const stats = codes.map((code) => {
    const rows = d.layers.filter((l) => l.code === code && l.p <= end);
    const last = rows[rows.length - 1];
    const v = r2(sum(rows, (l) => l.v)), q = Math.round(sum(rows, (l) => l.q) * 10000) / 10000;
    const c = r2(-sum(rows.filter((l) => inWin.has(l.p) && OUT_KINDS.has(l.kind)), (l) => l.v));
    const lastOut = d.lastOut[code] ?? null;
    const firstIn = rows.filter((l) => l.kind === "receipt").map((l) => l.p).sort()[0];
    const idle = lastOut ? dayDiff(today, lastOut) : firstIn ? dayDiff(today, `${firstIn}-01`) : 0;
    const flag: ProductStat["flag"] = v > 0 ? (idle >= DEAD_DAYS ? "dead" : idle >= SLOW_DAYS ? "slow" : null) : null;
    return { code, product: last.product, category: last.category, value: v, qty: q, cogs: c, days: c > 0 ? Math.round(v / (c / daysWin)) : null,
      turnover: v > 0 && c > 0 ? r2((c * 365 / daysWin) / v) : null, abc: "C" as ProductStat["abc"], lastOut, flag };
  });
  const totalCogs = sum(stats.filter((s) => s.cogs > 0), (s) => s.cogs);
  let cum = 0;
  for (const s of [...stats].sort((a, b) => b.cogs - a.cogs)) {
    if (totalCogs > 0 && s.cogs > 0) s.abc = cum / totalCogs < 0.8 ? "A" : cum / totalCogs < 0.95 ? "B" : "C";
    cum += Math.max(s.cogs, 0);
  }
  const products = stats.sort((a, b) => b.value - a.value);
  const slow = hasValue ? r2(sum(products.filter((p) => p.flag === "slow"), (p) => p.value)) : null;
  const dead = hasValue ? r2(sum(products.filter((p) => p.flag === "dead"), (p) => p.value)) : null;

  // ---- movements and locations (quantities)
  const mv = new Map<string, { p: string; kind: MoveKind; q: number }>();
  const locs = new Map<string, { loc: string; inQ: number; outQ: number }>();
  for (const m of d.moves.filter((x) => inWin.has(x.p))) {
    const k = `${m.p}|${m.kind}`;
    const e = mv.get(k) ?? { p: m.p, kind: m.kind, q: 0 };
    e.q += m.q; mv.set(k, e);
    for (const [loc, side] of [[m.to, "inQ"], [m.from, "outQ"]] as const) {
      if (!isInternalLocation(loc)) continue;
      const l = locs.get(loc) ?? { loc, inQ: 0, outQ: 0 };
      l[side] += m.q; locs.set(loc, l);
    }
  }

  // ---- tie-outs, month by month
  const tieouts: TieOut[] = [];
  const refsTo = <R extends { p: string; ref: string; v: number }>(rows: R[], keep: (r: R) => boolean, sign = 1) => {
    const o: Record<string, number> = {};
    for (const r of rows) if (keep(r)) o[r.ref] = (o[r.ref] ?? 0) + sign * r.v;
    return o;
  };
  const ledgerKind = (r: { ref: string; v: number }) => layerKind(r.ref, "", r.v);
  const hasLedgerRefs = d.ledger.length > 0;
  const stock = opts.ledger.stock;
  const firstLayer = d.layers.map((l) => l.p).sort()[0];
  const firstStock = stock ? Object.keys(stock).filter((p) => Math.abs(stock[p]) > 0.005).sort()[0] : undefined;
  const partialValuation = hasValue && !!firstStock && firstLayer > firstStock;
  if (hasValue) for (const p of periods) {
    if (!partialValuation) tieouts.push(tieOut("stock_value", p, closingAt(p), stock && p in stock ? stock[p] : null,
      hasLedgerRefs ? { module: refsTo(d.byRef, (r) => r.p <= p), ledger: refsTo(d.ledger, (r) => r.p <= p) } : undefined));
    const prev = addMonths(p, -1);
    tieouts.push(tieOut("stock_movement", p, sum(d.layers.filter((l) => l.p === p), (l) => l.v), stock && p in stock && prev in stock ? stock[p] - stock[prev] : null,
      hasLedgerRefs ? { module: refsTo(d.byRef, (r) => r.p === p), ledger: refsTo(d.ledger, (r) => r.p === p) } : undefined));
    tieouts.push(tieOut("cogs", p, -byKind(["delivery", "customer_return"], d.layers.filter((l) => l.p === p)), opts.ledger.cogs && p in opts.ledger.cogs ? opts.ledger.cogs[p] : null,
      hasLedgerRefs ? { module: refsTo(d.byRef, (r) => r.p === p && OUT_KINDS.has(r.kind), -1), ledger: refsTo(d.ledger, (r) => r.p === p && OUT_KINDS.has(ledgerKind(r)), -1) } : undefined));
    tieouts.push(tieOut("receipts", p, byKind(["receipt", "landed_cost", "supplier_return"], d.layers.filter((l) => l.p === p)),
      hasLedgerRefs ? sum(d.ledger.filter((r) => r.p === p && IN_KINDS.has(ledgerKind(r))), (r) => r.v) : null,
      hasLedgerRefs ? { module: refsTo(d.byRef, (r) => r.p === p && IN_KINDS.has(r.kind)), ledger: refsTo(d.ledger, (r) => r.p === p && IN_KINDS.has(ledgerKind(r))) } : undefined));
  }
  if (hasMoves) for (const p of periods) {
    const refs = new Set(d.rental.filter((r) => r.p === p).map((r) => r.ref));
    const valued: Record<string, number> = {};
    for (const r of d.byRef) if (r.p === p && refs.has(r.ref)) valued[r.ref] = (valued[r.ref] ?? 0) + Math.abs(r.v);
    tieouts.push(tieOut("rental_value", p, sum(Object.values(valued), (v) => v), 0, { module: valued, ledger: {} }));
  }
  const firstMove = d.moves.map((m) => m.p).sort()[0];
  if (d.onhand.length && hasMoves && (!firstLayer || firstMove <= firstLayer)) {
    const asOf = d.onhand[0].asOf, pa = asOf.slice(0, 7);
    const snap: Record<string, number> = {}, net: Record<string, number> = {};
    for (const o of d.onhand) snap[o.code || o.product] = (snap[o.code || o.product] ?? 0) + o.qty;
    for (const m of d.moves.filter((x) => x.p <= pa)) {
      const k = m.code || m.product;
      net[k] = (net[k] ?? 0) + (isInternalLocation(m.to) ? m.q : 0) - (isInternalLocation(m.from) ? m.q : 0);
    }
    tieouts.push(tieOut("qty_onhand", pa, sum(Object.values(snap), (v) => v), sum(Object.values(net), (v) => v), { module: snap, ledger: net }, 0));
  }

  // ---- findings
  const findings: InventoryFinding[] = [];
  const NAME: Record<string, [string, string]> = {
    stock_value: ["Stock value", "قيمة المخزون"], stock_movement: ["Stock movement", "حركة المخزون"], cogs: ["Cost of sales from deliveries", "تكلفة المبيعات من التسليمات"],
    receipts: ["Receipts and landed costs", "الاستلامات والتكاليف الواصلة"], rental_value: ["Rental moves", "حركات التأجير"], qty_onhand: ["Quantity on hand", "الكمية المتاحة"],
  };
  for (const t of tieouts.filter((x) => x.status === "off")) {
    const [en, a] = NAME[t.key];
    const units = t.key === "qty_onhand";
    const f = (v: number) => (units ? String(r2(v)) : fmt(v));
    const causes = t.causes.slice(0, 3).map((c) => `${c.ref} (${f(c.module - c.ledger)})`).join(", ");
    findings.push({
      kind: "risk",
      title: L(`${en} differs from the accounts in ${ml(t.period)}`, `${a} يختلف عن الحسابات في ${ml(t.period)}`),
      text: L(`Inventory shows ${f(t.module)}, the accounts ${f(t.ledger ?? 0)}: a difference of ${f(t.diff ?? 0)}.${causes ? ` Largest: ${causes}.` : ""}`,
        `المخزون يظهر ${f(t.module)} والحسابات ${f(t.ledger ?? 0)}: فرق ${f(t.diff ?? 0)}.${causes ? ` الأكبر: ${causes}.` : ""}`),
    });
  }
  const negative = d.onhand.filter((o) => o.qty < 0);
  if (negative.length) findings.push({
    kind: "risk",
    title: L(`Negative stock on hand for ${negative.length} item${negative.length > 1 ? "s" : ""}`, `رصيد مخزون سالب لعدد من الأصناف: ${negative.length}`),
    text: L(`${negative.slice(0, 3).map((o) => `${o.code || o.product} (${o.qty})`).join(", ")}: goods were delivered before they were received in Odoo, so their cost may be wrong.`,
      `${negative.slice(0, 3).map((o) => `${o.code || o.product} (${o.qty})`).join("، ")}: سُلّمت بضاعة قبل استلامها في Odoo، فقد تكون تكلفتها غير صحيحة.`),
  });
  const adj = -byKind(["adjustment", "scrap"]);
  if (cogs && cogs > 0 && adj / cogs > 0.01) findings.push({
    kind: "watch",
    title: L(`Adjustments and scrap are ${((adj / cogs) * 100).toFixed(1)}% of cost of sales`, `التسويات والهالك ${((adj / cogs) * 100).toFixed(1)}% من تكلفة المبيعات`),
    text: L(`${fmt(adj)} of stock written off or adjusted in ${label}. Check the counts and the reasons in Odoo.`, `${fmt(adj)} من المخزون شُطب أو سُوّي في ${label}. راجع الجرد والأسباب في Odoo.`),
  });
  if (value && value > 0 && slow !== null && dead !== null && (slow + dead) / value > 0.1) findings.push({
    kind: "watch",
    title: L(`${Math.round(((slow + dead) / value) * 100)}% of stock has not moved for 90 days or more`, `${Math.round(((slow + dead) / value) * 100)}% من المخزون لم يتحرك منذ 90 يومًا أو أكثر`),
    text: L(`${fmt(slow + dead)} of stock: ${fmt(dead)} has not gone out for 180 days. Consider promotions, returns to suppliers or write-downs.`, `${fmt(slow + dead)} من المخزون، منها ${fmt(dead)} لم تخرج منذ 180 يومًا. فكّر في عروض أو إرجاع للموردين أو تخفيض القيمة.`),
  });
  if (hasValue && opts.revenue) {
    const ago = addMonths(end, -3);
    const v0 = closingAt(ago), v1 = closingAt(end);
    const rev = (from: number, to: number) => { let s = 0, n = 0; for (let i = from; i < to; i++) { const p = addMonths(end, -i); if (p in opts.revenue!) { s += opts.revenue![p]; n++; } } return n === 3 ? s : null; };
    const r1 = rev(0, 3), r0 = rev(3, 6);
    if (v0 > 0 && r0 && r1 !== null) {
      const sg = v1 / v0 - 1, rg = r1 / r0 - 1;
      if (sg - rg >= 0.1) findings.push({
        kind: "watch",
        title: L("Stock is growing faster than sales", "المخزون ينمو أسرع من المبيعات"),
        text: L(`Over the last three months stock rose ${(sg * 100).toFixed(0)}% while sales changed ${(rg * 100).toFixed(0)}%: cash is being tied up in goods.`,
          `خلال الأشهر الثلاثة الأخيرة ارتفع المخزون ${(sg * 100).toFixed(0)}% بينما تغيرت المبيعات ${(rg * 100).toFixed(0)}%: النقدية تُحتجز في البضاعة.`),
      });
    }
  }

  const change = bridge ? bridge.closing - bridge.opening : 0;
  const headline = bridge
    ? L(`Stock is worth ${fmt(bridge.closing)} at the end of ${label}, ${change >= 0 ? "up" : "down"} ${fmt(Math.abs(change))} over the period. Goods delivered cost ${fmt(cogs ?? 0)}.`,
      `قيمة المخزون ${fmt(bridge.closing)} في نهاية ${label}، ${change >= 0 ? "بزيادة" : "بانخفاض"} ${fmt(Math.abs(change))} خلال الفترة. تكلفة البضاعة المسلّمة ${fmt(cogs ?? 0)}.`)
    : hasMoves ? L(`Stock movements for ${label} are loaded. Upload the valuation export to see values and check them against the accounts.`, `حركات المخزون لـ ${label} محمّلة. ارفع تقرير التقييم لرؤية القيم ومطابقتها مع الحسابات.`)
    : L("No stock records loaded yet.", "لا توجد سجلات مخزون بعد.");

  return {
    hasValue, hasMoves, partialValuation, label,
    tiles: { value, days: value !== null && cogs && cogs > 0 ? Math.round(value / (cogs / daysWin)) : null, cogs, slow, dead },
    bridge, products, movements: [...mv.values()].map((m) => ({ ...m, q: Math.round(m.q * 10000) / 10000 })), locations: [...locs.values()],
    tieouts, findings, headline,
  };
}

/**
 * The ledger side of the tie-outs, from data every company already has: the closing balance of the accounts mapped to
 * Inventory (balance sheet, per month) and the cost of sales posted by stock moves or with customer invoices (the expense
 * lines grouped as "Cost of goods sold (stock)").
 */
export function inventoryLedger(months: { period: string; bs: Partial<Record<string, number>> }[], expenses: { suppliers: { p: string; s: string; c: string | null; a: number }[] }): { stock: Record<string, number> | null; cogs: Record<string, number> | null } {
  const stock: Record<string, number> = {};
  for (const m of months) if (Object.keys(m.bs).length) stock[m.period] = Number(m.bs.inventory ?? 0);
  const cogs: Record<string, number> = {};
  for (const r of expenses.suppliers) if (r.s === COGS_SUPPLIER && (r.c === "cos_variable" || r.c === "cos_fixed")) cogs[r.p] = r2((cogs[r.p] ?? 0) + r.a);
  return { stock: Object.keys(stock).length ? stock : null, cogs: Object.keys(cogs).length ? cogs : null };
}

const sumV = (rows: LayerRow[]) => rows.reduce((s, l) => s + l.v, 0);

/** One month's stock value: where it opened, what each kind of layer added or took, and where it closed (adds up exactly). */
export function monthBridge(d: InventoryData, p: string): InventoryBridge {
  const rows = d.layers.filter((l) => l.p === p);
  const k = (ks: LayerKind[]) => r2(sumV(rows.filter((l) => ks.includes(l.kind))));
  return {
    opening: r2(sumV(d.layers.filter((l) => l.p < p))),
    receipts: k(["receipt"]), landed: k(["landed_cost"]), deliveries: k(["delivery"]), returns: k(["customer_return", "supplier_return"]),
    adjustments: k(["adjustment", "scrap", "other"]), revaluation: k(["revaluation"]),
    closing: r2(sumV(d.layers.filter((l) => l.p <= p))),
  };
}

/** The n months up to the end: closing stock value, cost of goods delivered (net of customer returns) and goods received (landed costs and supplier returns included). */
export function inventoryMonthly(d: InventoryData, end: string, n = 12): { p: string; closing: number; cogs: number; received: number }[] {
  return Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1)).map((p) => {
    const rows = d.layers.filter((l) => l.p === p);
    return {
      p, closing: r2(sumV(d.layers.filter((l) => l.p <= p))),
      cogs: r2(-sumV(rows.filter((l) => OUT_KINDS.has(l.kind)))) || 0,
      received: r2(sumV(rows.filter((l) => IN_KINDS.has(l.kind)))),
    };
  });
}

/** What one unit cost when received, per product and month (value ÷ quantity of receipt layers); null in a month with no receipts. */
export function receiptCost(d: InventoryData, codes: string[], periods: string[]): { code: string; product: string; points: (number | null)[] }[] {
  return codes.map((code) => {
    const rows = d.layers.filter((l) => l.code === code && l.kind === "receipt" && l.q > 0);
    return {
      code, product: rows[rows.length - 1]?.product ?? code,
      points: periods.map((p) => { const m = rows.filter((l) => l.p === p); const q = m.reduce((s, l) => s + l.q, 0); return q > 0 ? r2(sumV(m) / q) : null; }),
    };
  });
}

/** Every tie-out, once per check and month, over the last n months with stock records (for readiness and Data health). */
export function inventoryTieOuts(d: InventoryData, ledger: { stock: Record<string, number> | null; cogs: Record<string, number> | null }, fyStart: number, n = 12, today?: string): TieOut[] {
  const months = [...new Set([...d.layers.map((l) => l.p), ...d.moves.map((m) => m.p)])].sort().slice(-n);
  const ties = new Map<string, TieOut>();
  for (const p of months) for (const t of inventoryAnalysis(d, { type: "month", end: p }, fyStart, { ledger, today }).tieouts) ties.set(`${t.key}|${t.period}`, t);
  return [...ties.values()].sort((a, b) => a.period.localeCompare(b.period));
}
