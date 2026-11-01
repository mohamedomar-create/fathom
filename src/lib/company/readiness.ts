import { balanced as bsBalanced, tied as agrees } from "@/lib/tolerance";
import { addMonths, bsCalc, cashFlowByMonth, COSTS_DEFINITION, EXPENSE_GROUPS, expenseMonths, hasBS, hasPL, isAnnualColumn, isCostLine, mlabel, monthIndex, NOT_SUPPLIERS, plCalc, type Assumptions, type ExpensesData, type ForecastDrivers, type MonthData, type SalesData } from "@/lib/engine";
import { inventoryLedger, inventoryTieOuts, type InventoryData } from "@/lib/engine/inventory";
import type { TieOut } from "@/lib/engine/tieout";
import { paymentsAnalysis, type PaymentsData, type Side } from "@/lib/engine/payments";
import type { TemplateKind } from "@/lib/templates/spec";
import type { Check } from "./checks";
import { monthLabel, type Lang } from "@/lib/i18n";
import { dat } from "@/lib/i18n/areas/dat";

/**
 * How ready each sector's data is: what is loaded (completion) and how much of it passes the accounting checks
 * (accuracy), item by item, each with exactly what to upload or enter and how.
 */
export type ReadinessSector = "financials" | "sales" | "expenses" | "inventory" | "payments" | "banking" | "forecast";
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
/** unread: its figures could not be read just now, so its scores are unknown (never shown as 0% or "missing"). */
/** pending: its figures are still being added up after an upload (shown as such, never as 0% or "missing"). */
export interface SectorReadiness { key: ReadinessSector; label: string; completion: number; accuracy: number | null; items: ReadinessItem[]; unread?: boolean; pending?: boolean }

export interface ReadinessInput {
  months: MonthData[];
  /** The unit the books were stated in (1,000 for a file "in thousands"). */
  unit?: number;
  checks: Check[];
  fyStart: number;
  sales?: SalesData | null;
  expenses?: ExpensesData | null;
  inventory?: InventoryData | null;
  /** The accounts by code and name (the stock interim accounts feed the cost-of-sales check). */
  accounts?: { code?: string; name: string; cls: string; amounts: Record<string, number> }[];
  /** The company's location types (which locations hold stock). */
  locationTypes?: Record<string, "internal" | "transit" | "rental" | "outside">;
  assumptions?: Assumptions;
  forecast?: ForecastDrivers;
  today?: string;
  /** The ageing reports and payments, with the control accounts the company chose (the Payments sector shows only when given). */
  payments?: { data: PaymentsData; control?: Partial<Record<Side, string[]>> };
  /** The company said its books start from zero (nothing before the first month), so no opening balance is due. */
  booksFromZero?: boolean;
  /** Sectors whose figures could not be read just now. */
  unread?: ReadinessSector[];
  /** Sectors whose figures are still being added up. */
  pending?: ReadinessSector[];
  /** Where the books come from: statements and cash books have no General Ledger, so fixes never ask for one. */
  basis?: "ledger" | "odoo" | "statements" | "cash";
  /** The language of the words (English when not given); figures and scores are the same in both. */
  lang?: Lang;
}

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);
const status = (c: number, a: number | null): ItemStatus => (c >= 100 && (a === null || a >= 100) ? "done" : c <= 0 ? "missing" : "partial");
const item = (i: Omit<ReadinessItem, "status">): ReadinessItem => ({ ...i, status: status(i.completion, i.accuracy) });
const isoToday = () => new Date().toISOString().slice(0, 10);
/** The readiness words in the input's language (English when none is given). */
const words = (x: Pick<ReadinessInput, "lang">) => (x.lang === "ar" ? dat.ar.rd : dat.en.rd);
/** "2026-09" as "Sep 2026" (or its Arabic). */
const monthOf = (x: Pick<ReadinessInput, "lang">) => (x.lang === "ar" ? (p: string) => monthLabel(p, "ar") : mlabel);

const glFix = (x: Pick<ReadinessInput, "lang">): ReadinessFix => ({ what: words(x).glWhat, how: words(x).glHow, template: "financials", href: "data/upload?step=financials" });
const statementsFix = (x: Pick<ReadinessInput, "lang">): ReadinessFix => ({ what: words(x).stWhat, how: words(x).stHow, template: "financials", href: "data/upload?step=financials" });
/** Books without a General Ledger behind them (statements, or a cash book moved to the full system). */
const noLedger = (x: Pick<ReadinessInput, "basis">) => x.basis === "statements" || x.basis === "cash";
/** What to upload for more months of books: the General Ledger, or statements when the company keeps no ledger. */
const booksFix = (x: Pick<ReadinessInput, "basis" | "lang">) => (noLedger(x) ? statementsFix(x) : glFix(x));

function summarise(items: ReadinessItem[]): { completion: number; accuracy: number | null } {
  const completion = Math.round(items.reduce((s, i) => s + i.completion, 0) / Math.max(1, items.length));
  const acc = items.filter((i) => i.accuracy !== null && i.completion > 0);
  const accuracy = acc.length ? Math.round(acc.reduce((s, i) => s + i.accuracy!, 0) / acc.length) : null;
  return { completion, accuracy };
}

/** Months holding a P&L, oldest first. */
const plMonths = (ms: MonthData[]) => [...ms].filter(hasPL).sort((a, b) => a.period.localeCompare(b.period));

export function financialsReadiness(x: ReadinessInput): SectorReadiness {
  const t = words(x), ml = monthOf(x);
  const pl = plMonths(x.months);
  const by = new Map(x.months.map((m) => [m.period, m]));
  const items: ReadinessItem[] = [];
  const last12 = pl.slice(-12);
  const blockedIn = (p: string, st?: "PL" | "BS") => x.checks.some((c) => c.severity === "block" && c.period === p && (!st || !c.statement || c.statement === st));
  const annual = pl.length > 0 && isAnnualColumn(x.months, pl[pl.length - 1].period, x.fyStart);
  if (!pl.length) {
    items.push(item({ id: "pl", axis: t.plAxis, title: t.plTitle0, completion: 0, accuracy: null, detail: t.noPl, fix: booksFix(x) }));
  } else {
    const n = annual ? 12 : last12.length;
    items.push(item({
      id: "pl", axis: t.plAxis, title: t.plTitle,
      completion: pct(n / 12), accuracy: pct(1 - last12.filter((m) => blockedIn(m.period, "PL")).length / Math.max(1, last12.length)),
      detail: annual ? t.plAnnual : t.plLast12(last12.length, ml(last12[0].period), ml(last12[last12.length - 1].period)),
      fix: n < 12 || annual ? { ...booksFix(x), what: annual ? t.plAnnualWhat(noLedger(x)) : t.plEarlierWhat(12 - n) } : undefined,
    }));
  }
  const withBS = last12.filter(hasBS);
  const balanced = withBS.filter((m) => { const b = bsCalc(m.bs); return bsBalanced(b.imbalance, x.unit); });
  items.push(item({
    id: "bs", axis: t.bsAxis, title: t.bsTitle,
    completion: pl.length ? pct(withBS.length / last12.length) : 0, accuracy: withBS.length ? pct(balanced.length / withBS.length) : null,
    detail: !pl.length ? t.noMonths : t.bsDetail(withBS.length, last12.length, balanced.length),
    fix: withBS.length < last12.length ? { what: t.bsWhat, how: booksFix(x).how, template: "financials", href: "data/upload?step=financials" }
      : balanced.length < withBS.length ? { what: t.unbalWhat, how: t.unbalHow, href: "data/checks" } : undefined,
  }));
  const first = pl[0]?.period;
  const open = first ? by.get(addMonths(first, -1)) : undefined;
  const openOk = !!open && hasBS(open);
  const openBal = openOk ? bsBalanced(bsCalc(open!.bs).imbalance, x.unit) : false;
  if (!openOk && first && x.booksFromZero) items.push(item({
    id: "opening", axis: t.openAxis, title: t.openTitle,
    completion: 100, accuracy: null, detail: t.openZero(ml(first)),
  }));
  else items.push(item({
    id: "opening", axis: t.openAxis, title: t.openTitle,
    completion: openOk ? 100 : 0, accuracy: openOk ? (openBal ? 100 : 0) : null,
    detail: !first ? t.noMonths : openOk ? t.openLoaded(ml(open!.period), openBal) : t.openNone(ml(first)),
    fix: openOk ? undefined : { what: t.openWhat(first ? monthEndLabel(addMonths(first, -1), ml) : null), how: noLedger(x) ? t.openHowNl : t.openHow, template: "opening", href: "data/upload?step=opening" },
  }));
  if (pl.length) {
    const span = monthIndex(pl[pl.length - 1].period) - monthIndex(pl[0].period) + 1;
    const gaps = annual ? 0 : span - pl.length;
    items.push(item({
      id: "gaps", axis: t.gapsAxis, title: t.gapsTitle,
      completion: pct(1 - gaps / Math.max(1, span)), accuracy: null,
      detail: gaps ? t.gaps(gaps) : t.noGaps,
      fix: gaps ? { ...booksFix(x), what: t.gapsWhat, href: "data/checks" } : undefined,
    }));
    const today = x.today ?? isoToday();
    const behind = monthIndex(today.slice(0, 7)) - monthIndex(pl[pl.length - 1].period);
    items.push(item({
      id: "fresh", axis: t.freshAxis, title: t.freshTitle,
      completion: behind <= 1 ? 100 : behind === 2 ? 60 : behind === 3 ? 30 : 0, accuracy: null,
      detail: t.latest(ml(pl[pl.length - 1].period)),
      fix: behind > 1 ? { ...booksFix(x), what: t.after(ml(pl[pl.length - 1].period)) } : undefined,
    }));
    const cf = cashFlowByMonth(x.months, last12.map((m) => m.period));
    const clean = cf.rows.filter((r) => r.unreconciled === 0).length;
    items.push(item({
      id: "cash", axis: t.cashAxis, title: t.cashTitle,
      completion: pct(cf.rows.length / Math.max(1, last12.length)), accuracy: cf.rows.length ? pct(clean / cf.rows.length) : null,
      detail: cf.rows.length ? t.cash(clean, cf.rows.length) : t.cashNeeds,
      fix: cf.rows.length && clean < cf.rows.length ? { what: t.cashWhat, how: t.cashHow, href: "data/checks" } : undefined,
    }));
  }
  return { key: "financials", label: t.labels.financials, ...summarise(items), items };
}

export function salesReadiness(x: ReadinessInput): SectorReadiness {
  const t = words(x);
  const s = x.sales;
  const SALES_FIX: ReadinessFix = { what: t.salesWhat, how: t.salesHow, template: "sales", href: "data/upload?step=sales" };
  const months = s ? [...new Set(s.customers.map((r) => r.p))].sort() : [];
  const items: ReadinessItem[] = [];
  if (!s || !months.length) {
    items.push(item({ id: "loaded", axis: t.salesLoadedAxis, title: t.salesLines, completion: 0, accuracy: null, detail: t.noSales, fix: SALES_FIX }));
    return { key: "sales", label: t.labels.sales, ...summarise(items), items };
  }
  const pl = plMonths(x.months).slice(-12);
  const plSet = new Set(pl.map((m) => m.period));
  const covered = pl.length ? pl.filter((m) => months.includes(m.period)).length / pl.length : 1;
  items.push(item({ id: "loaded", axis: t.coveredAxis, title: t.salesCoveredTitle, completion: pct(covered), accuracy: null,
    detail: pl.length ? t.salesCovered(pl.filter((m) => months.includes(m.period)).length, pl.length) : t.salesMonths(months.length),
    fix: covered < 1 ? { ...SALES_FIX, what: t.salesMissingWhat } : undefined }));
  const byMonth = new Map<string, number>();
  for (const r of s.customers) byMonth.set(r.p, (byMonth.get(r.p) ?? 0) + r.a);
  const both = pl.filter((m) => byMonth.has(m.period) && plSet.has(m.period));
  const tied = both.filter((m) => { const rev = plCalc(m.pl).revenue; return agrees(byMonth.get(m.period) ?? 0, rev); });
  items.push(item({ id: "reconciled", axis: t.tiesAxis, title: t.salesTiesTitle, completion: both.length ? 100 : 0, accuracy: both.length ? pct(tied.length / both.length) : null,
    detail: both.length ? t.salesTies(tied.length, both.length) : t.loadPl,
    fix: both.length && tied.length < both.length ? { what: t.salesMatchWhat, how: t.salesMatchHow, template: "sales", href: "sales" } : undefined }));
  const total = s.customers.reduce((tt, r) => tt + Math.abs(r.a), 0) || 1;
  const named = s.customers.filter((r) => r.c && r.c !== "No customer").reduce((tt, r) => tt + Math.abs(r.a), 0);
  items.push(item({ id: "customers", axis: t.custAxis, title: t.custTitle, completion: pct(named / total), accuracy: null, detail: t.cust(pct(named / total)),
    fix: named < total ? { what: t.custWhat, how: t.custHow, template: "sales" } : undefined }));
  const ptotal = s.products.reduce((tt, r) => tt + Math.abs(r.a), 0) || 1;
  const cat = s.products.filter((r) => r.g && r.g !== "No category").reduce((tt, r) => tt + Math.abs(r.a), 0);
  items.push(item({ id: "categories", axis: t.catAxis, title: t.catTitle, completion: pct(cat / ptotal), accuracy: null, detail: t.cat(pct(cat / ptotal)),
    fix: cat < ptotal ? { what: t.catWhat, how: t.catHow, template: "sales" } : undefined }));
  const qty = s.products.filter((r) => r.q !== null).reduce((tt, r) => tt + Math.abs(r.a), 0);
  items.push(item({ id: "qty", axis: t.qtyAxis, title: t.qtyTitle, completion: pct(qty / ptotal), accuracy: null, detail: qty ? t.qty(pct(qty / ptotal)) : t.noQty,
    fix: qty < ptotal ? { what: t.qtyWhat, how: t.qtyHow, template: "sales" } : undefined }));
  const costed = s.products.reduce((tt, r) => tt + Math.abs(r.ka ?? 0), 0);
  items.push(item({ id: "cost", axis: t.costAxis, title: t.costTitle, completion: pct(costed / ptotal), accuracy: null, detail: costed ? t.cost(pct(costed / ptotal)) : t.noCost,
    fix: costed < ptotal ? { what: t.costWhat, how: t.costHow, template: "sales" } : undefined }));
  return { key: "sales", label: t.labels.sales, ...summarise(items), items };
}

const COST_CLASSES = EXPENSE_GROUPS.flatMap((g) => g.classes);
/** A month's P&L costs, as the Expenses pages add them up. */
const COS_CLASSES = ["cos_variable", "cos_fixed", "cos_depreciation"] as const;
const costsOf = (m: MonthData) => COST_CLASSES.reduce((t, k) => t + ((m.pl as Record<string, number>)[k] ?? 0), 0);

export function expensesReadiness(x: ReadinessInput): SectorReadiness {
  const t = words(x), ml = monthOf(x);
  const e = x.expenses;
  const nl = noLedger(x);
  const FIX: ReadinessFix = nl
    ? { what: t.expNlWhat, how: t.expNlHow, template: "expenses", href: "data/upload?step=expenses" }
    : { what: t.expGlWhat, how: t.expGlHow, template: "financials", href: "data/upload?step=financials" };
  const forMonths = nl ? t.forMonthsNl : t.forMonthsGl;
  const months = e ? expenseMonths(e) : [];
  const items: ReadinessItem[] = [];
  if (!e || !months.length) {
    items.push(item({ id: "loaded", axis: t.expLoadedAxis, title: t.expLinesTitle, completion: 0, accuracy: null, detail: t.noExp, fix: FIX }));
    return { key: "expenses", label: t.labels.expenses, ...summarise(items), items };
  }
  const pl = plMonths(x.months).slice(-12);
  const n = pl.filter((m) => months.includes(m.period)).length;
  const covered = pl.length ? n / pl.length : 1;
  items.push(item({ id: "loaded", axis: t.coveredAxis, title: t.expCoveredTitle, completion: pct(covered), accuracy: null,
    detail: pl.length ? t.expCovered(n, pl.length) : t.expMonths(months.length),
    fix: covered < 1 ? { ...FIX, what: t.forMissing(forMonths) } : undefined }));
  const byMonth = new Map<string, number>();
  for (const r of e.suppliers) if (isCostLine(r.c)) byMonth.set(r.p, (byMonth.get(r.p) ?? 0) + r.a);
  const both = pl.filter((m) => byMonth.has(m.period));
  const tied = both.filter((m) => { const c = costsOf(m); return agrees(byMonth.get(m.period) ?? 0, c); });
  // Cost of sales is part of P&L costs: lines that leave it out (a bills list, or an expense file without the stock
  // journal) can never tie, and the reason is said with the amount.
  const cosOf = (m: MonthData) => COS_CLASSES.reduce((tt, k) => tt + ((m.pl as Record<string, number>)[k] ?? 0), 0);
  const cosLines = new Map<string, number>();
  for (const r of e.suppliers) if (COS_CLASSES.includes(r.c as (typeof COS_CLASSES)[number])) cosLines.set(r.p, (cosLines.get(r.p) ?? 0) + r.a);
  const noCos = both.filter((m) => cosOf(m) > 1 && Math.abs(cosLines.get(m.period) ?? 0) < cosOf(m) * 0.01);
  const missing = noCos.length ? noCos.reduce((tt, m) => tt + cosOf(m), 0) / noCos.length : 0;
  items.push(item({ id: "reconciled", axis: t.tiesAxis, title: t.expTiesTitle, completion: both.length ? 100 : 0, accuracy: both.length ? pct(tied.length / both.length) : null,
    detail: (both.length ? t.expTies(tied.length, both.length) : t.loadPl)
      + (noCos.length ? t.cosMissing(Math.round(missing).toLocaleString("en-US"), noCos.length) : "")
      + ` ${x.lang === "ar" ? t.costsDef : COSTS_DEFINITION}`,
    fix: both.length && tied.length < both.length ? (noCos.length
      ? { what: t.inclCosWhat, how: t.inclCosHow(nl), template: nl ? "expenses" : "financials", href: "expenses/trend" }
      : nl ? { what: t.everyCostWhat, how: t.everyCostHow, template: "expenses", href: "expenses/trend" }
      : { what: t.glCostsWhat, how: t.glCostsHow, template: "financials", href: "expenses/trend" }) : undefined }));
  const pay = e.suppliers.filter((r) => r.s !== "Depreciation (no payment)" && r.s !== "Cost of goods sold (stock)" && isCostLine(r.c));
  const total = pay.reduce((tt, r) => tt + Math.abs(r.a), 0) || 1;
  const named = pay.filter((r) => !NOT_SUPPLIERS.has(r.s)).reduce((tt, r) => tt + Math.abs(r.a), 0);
  items.push(item({ id: "suppliers", axis: t.supAxis, title: t.supTitle, completion: pct(named / total / 0.8), accuracy: null,
    detail: t.sup(pct(named / total)),
    fix: named / total < 0.8 ? { what: t.supWhat, how: t.supHow, template: "expenses" } : undefined }));
  const costAcc = e.accounts.filter((r) => isCostLine(r.c));
  const atotal = costAcc.reduce((tt, r) => tt + Math.abs(r.a), 0) || 1;
  const typed = costAcc.filter((r) => r.c).reduce((tt, r) => tt + Math.abs(r.a), 0);
  items.push(item({ id: "types", axis: t.typesAxis, title: t.typesTitle, completion: pct(typed / atotal), accuracy: null, detail: t.types(pct(typed / atotal)),
    fix: typed < atotal ? { what: t.typesWhat, how: t.typesHow, template: "expenses" } : undefined }));
  const latest = pl[pl.length - 1]?.period;
  if (latest) items.push(item({ id: "fresh", axis: t.freshAxis, title: t.expFreshTitle, completion: months.includes(latest) ? 100 : 0, accuracy: null,
    detail: months.includes(latest) ? t.isIn(ml(latest)) : t.noLinesYet(ml(latest)),
    fix: months.includes(latest) ? undefined : { ...FIX, what: t.forMonth(forMonths, ml(latest)) } }));
  return { key: "expenses", label: t.labels.expenses, ...summarise(items), items };
}

const TIE_KEYS: TieOut["key"][] = ["stock_value", "stock_movement", "cogs", "receipts", "rental_value", "qty_onhand", "qty_valued", "onhand_value"];

/** Stock: what is loaded (valuation, moves, on hand, with Odoo IDs) and, per check, how many months agree with the accounts (last 12 months with stock records). */
/** The stock tie-outs, month by month, against the accounts (the same checks the Inventory pages show). */
export function inventoryTies(x: ReadinessInput) {
  return x.inventory ? inventoryTieOuts(x.inventory, inventoryLedger(x.months, x.expenses ?? { suppliers: [] }, x.accounts), x.fyStart, 12, x.locationTypes) : [];
}

export function inventoryReadiness(x: ReadinessInput): SectorReadiness {
  const t = words(x);
  const d = x.inventory;
  const FIX: ReadinessFix = { what: t.valWhat, how: t.stockExport, href: "data/upload?step=inventory" };
  const items: ReadinessItem[] = [];
  if (!d || (!d.layers.length && !d.moves.months.length && !d.onhand.length)) {
    items.push(item({ id: "valuation", axis: t.valAxis, title: t.stockRecords, completion: 0, accuracy: null, detail: t.noStock, fix: FIX }));
    return { key: "inventory", label: t.labels.inventory, ...summarise(items), items };
  }
  const loaded = (id: string, axis: string, title: string, has: boolean, what: string) =>
    items.push(item({ id, axis, title, completion: has ? 100 : 0, accuracy: null, detail: has ? t.loaded : t.notLoaded, fix: has ? undefined : { ...FIX, what } }));
  loaded("valuation", t.valAxis, t.valTitle, d.layers.length > 0, t.valWhat);
  loaded("moves", t.movesAxis, t.movesTitle, d.moves.months.length > 0, t.movesWhat);
  loaded("onhand", t.onhandAxis, t.onhandTitle, d.onhand.length > 0, t.onhandWhat);
  items.push(item({ id: "ids", axis: t.idsAxis, title: t.idsTitle, completion: d.meta.withIds ? 100 : 0, accuracy: null,
    detail: d.meta.withIds ? t.idsYes : t.idsNo,
    fix: d.meta.withIds ? undefined : { what: t.idsWhat, how: t.idsHow, href: "data/upload?step=inventory" } }));
  const ties = inventoryTies(x);
  for (const key of TIE_KEYS) {
    const axis = t.tieAxis[key], title = t.tieTitle[key];
    const all = ties.filter((tt) => tt.key === key);
    if (!all.length) continue;
    const checked = all.filter((tt) => tt.status !== "no_ledger"), ok = checked.filter((tt) => tt.status === "ok");
    items.push(item({ id: `tie_${key}`, axis, title, completion: checked.length ? 100 : 0, accuracy: checked.length ? pct(ok.length / checked.length) : null,
      detail: checked.length ? t.tieAgree(ok.length, checked.length) : t.tieNothing,
      fix: !checked.length ? { ...booksFix(x), what: noLedger(x) ? t.tieNlWhat : t.tieGlWhat } : ok.length < checked.length ? { what: t.tieFindWhat, how: t.tieFindHow, href: "inventory/valuation" } : undefined }));
  }
  return { key: "inventory", label: t.labels.inventory, ...summarise(items), items };
}

/** Each ageing report against its control account at its date (the same tie-out the Payments pages show). */
export function agedTieouts(x: ReadinessInput) {
  const d = x.payments?.data ?? { aged: {}, payments: [] };
  const last = Object.values(d.aged).map((a) => a!.asOf).sort().pop() ?? d.payments.map((p) => p.day).sort().pop();
  return paymentsAnalysis(d, { type: "month", end: (last ?? "2000-01").slice(0, 7) }, x.fyStart, {
    accounts: (x.accounts ?? []).filter((c) => c.cls === "ar" || c.cls === "ap").map((c) => ({ code: c.code ?? "", name: c.name, cls: c.cls, amounts: c.amounts })),
    control: x.payments?.control,
  }).tieouts;
}

/** Receivables and payables: each ageing report loaded and agreeing with its control account at its date, and the payments list loaded. */
export function paymentsReadiness(x: ReadinessInput): SectorReadiness {
  const t = words(x);
  const d = x.payments?.data ?? { aged: {}, payments: [] };
  const FIX: ReadinessFix = { what: "", how: t.payHow, href: "data/upload?step=payments" };
  const a = { tieouts: agedTieouts(x) };
  const items: ReadinessItem[] = [];
  for (const side of ["receivable", "payable"] as const) {
    const title = t.agedTitle[side];
    const tt = a.tieouts.find((v) => v.side === side);
    const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
    items.push(item({ id: `aged_${side}`, axis: t.agedAxis[side], title, completion: tt ? 100 : 0,
      accuracy: !tt || tt.status === "no_books" ? null : tt.status === "ok" ? 100 : 0,
      detail: !tt ? t.agedNone(side) : tt.status === "no_books" ? t.agedNoBooks(tt.asOf)
        : tt.status === "ok" ? t.agedOk(tt.asOf, n(tt.ageing), tt.account) : t.agedOff(tt.asOf, n(tt.ageing), n(tt.diff!), tt.account),
      fix: !tt ? { ...FIX, what: t.agedWhat(side) } : tt.status === "off" ? { what: t.agedFindWhat, how: t.agedFindHow, href: "payments" } : undefined }));
  }
  items.push(item({ id: "payments", axis: t.payAxis, title: t.payTitle, completion: d.payments.length ? 100 : 0, accuracy: null,
    detail: d.payments.length ? t.payLoaded(d.payments.length) : t.noPay, fix: d.payments.length ? undefined : { ...FIX, what: t.payWhat } }));
  return { key: "payments", label: t.labels.payments, ...summarise(items), items };
}

export function bankingReadiness(x: ReadinessInput): SectorReadiness {
  const t = words(x);
  const pl = plMonths(x.months);
  const a = x.assumptions ?? {};
  const annualYears = pl.filter((m) => isAnnualColumn(x.months, m.period, x.fyStart)).length;
  const items: ReadinessItem[] = [];
  const hist = annualYears >= 3 ? 1 : Math.max(pl.length / 24, annualYears / 3);
  items.push(item({ id: "history", axis: t.histAxis, title: t.histTitle, completion: pct(hist), accuracy: null,
    detail: t.hist(pl.length, annualYears),
    fix: hist < 1 ? { what: t.histWhat, how: noLedger(x) ? t.histHowNl : t.histHow, template: "financials", href: "data/upload?step=financials" } : undefined }));
  const last = [...x.months].filter(hasBS).sort((p, q) => p.period.localeCompare(q.period)).pop();
  const debt = last ? bsCalc(last.bs).debt : 0;
  const hasNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  items.push(item({ id: "repay", axis: t.repayAxis, title: t.repayTitle, completion: debt <= 0 || hasNum(a.principal12m) ? 100 : 0, accuracy: null,
    detail: debt <= 0 ? t.noDebt : hasNum(a.principal12m) ? t.entered : t.repayNot,
    fix: debt > 0 && !hasNum(a.principal12m) ? { what: t.repayWhat, how: t.onBanking, href: "banking" } : undefined }));
  items.push(item({ id: "rate", axis: t.rateAxis, title: t.rateTitle, completion: hasNum(a.rate) ? 100 : 0, accuracy: null, detail: hasNum(a.rate) ? t.rate(a.rate!) : t.notEntered,
    fix: hasNum(a.rate) ? undefined : { what: t.rateWhat, how: t.onBanking, href: "banking" } }));
  items.push(item({ id: "request", axis: t.reqAxis, title: t.reqTitle, completion: hasNum(a.requestAmount) ? 100 : 0, accuracy: null, detail: hasNum(a.requestAmount) ? t.entered : t.notEntered,
    fix: hasNum(a.requestAmount) ? undefined : { what: t.reqWhat, how: t.onBanking, href: "banking" } }));
  items.push(item({ id: "economy", axis: t.ecoAxis, title: t.ecoTitle, completion: hasNum(a.inflation) ? (hasNum(a.fxStart) && hasNum(a.fxEnd) ? 100 : 60) : 0, accuracy: null,
    detail: hasNum(a.inflation) ? t.entered : t.ecoNot,
    fix: hasNum(a.inflation) && hasNum(a.fxStart) && hasNum(a.fxEnd) ? undefined : { what: t.ecoWhat, how: t.onRealProfit, href: "analysis/real-profit" } }));
  const fin = financialsReadiness(x);
  const bal = fin.items.find((i) => i.id === "bs");
  if (bal) items.push({ ...bal, axis: t.bsAxis });
  return { key: "banking", label: t.labels.banking, ...summarise(items), items };
}

export function forecastReadiness(x: ReadinessInput): SectorReadiness {
  const t = words(x), ml = monthOf(x);
  const pl = plMonths(x.months);
  let run = pl.length ? 1 : 0;
  for (let i = pl.length - 1; i > 0 && monthIndex(pl[i].period) - monthIndex(pl[i - 1].period) === 1; i--) run++;
  const last = pl[pl.length - 1];
  const items: ReadinessItem[] = [
    item({ id: "run", axis: t.histAxis, title: t.runTitle, completion: pct(run / 12), accuracy: null, detail: t.run(run),
      fix: run < 12 ? { ...booksFix(x), what: t.runWhat } : undefined }),
    item({ id: "start", axis: t.startAxis, title: t.startTitle, completion: last && hasBS(last) ? 100 : 0, accuracy: null,
      detail: last ? (hasBS(last) ? t.startsFrom(ml(last.period)) : t.noBs(ml(last.period))) : t.noMonths,
      fix: last && hasBS(last) ? undefined : { ...booksFix(x), what: t.startWhat } }),
    item({ id: "drivers", axis: t.drvAxis, title: t.drvTitle, completion: x.forecast && Object.keys(x.forecast).length ? 100 : 0, accuracy: null,
      detail: x.forecast && Object.keys(x.forecast).length ? t.drvSaved : t.drvDefault,
      fix: x.forecast && Object.keys(x.forecast).length ? undefined : { what: t.drvWhat, how: t.onForecast, href: "analysis/forecast" } }),
  ];
  return { key: "forecast", label: t.labels.forecast, ...summarise(items), items };
}

export function readiness(x: ReadinessInput): SectorReadiness[] {
  const all = [financialsReadiness(x), salesReadiness(x), expensesReadiness(x), inventoryReadiness(x), ...(x.payments ? [paymentsReadiness(x)] : []), bankingReadiness(x), forecastReadiness(x)];
  return all.map((r) => (x.unread?.includes(r.key) ? { ...r, unread: true } : x.pending?.includes(r.key) ? { ...r, pending: true } : r));
}

/** "31 Dec 2025" for the month "2025-12". */
function monthEndLabel(p: string, ml: (p: string) => string = mlabel): string {
  const d = new Date(Date.UTC(Number(p.slice(0, 4)), Number(p.slice(5)), 0));
  return `${d.getUTCDate()} ${ml(p)}`;
}
