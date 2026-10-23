import { breakeven, type BreakevenResult } from "./breakeven";
import { addMonths, money, monthIndex, pct } from "./format";
import { METHOD_ABOUT, METHOD_ABOUT_AR, METHOD_LABEL, METHOD_LABEL_AR, METHOD_NEEDS, methodTrials, projectRevenue, rangeWidth, type RevenueMethod } from "./forecast";
import { KPI_BY_KEY } from "./kpis";
import { plCalc, sumPL } from "./statements";
import type { PLCalc, PLInput, PLKey } from "./types";
import { monthLabel } from "@/lib/i18n";
import type { SalesLine } from "@/lib/ingest/sales";
import type { ExpenseLine } from "@/lib/ingest/expenses";
import type { OpeningCash } from "@/lib/company/mode";

/**
 * Simple mode: every figure from the Sales and Expenses lines alone (no ledger, no balance sheet).
 *
 * The P&L is built in memory from the lines and run through the same plCalc / sumPL / breakeven as Full mode, so a
 * margin or a break-even point means exactly the same thing in both. Nothing here is stored, and Full mode never calls it.
 */

/** What a figure needs when it cannot be shown: the page says "Needs …" instead of showing 0. */
export type Need =
  | "opening_cash" | "paid_column" | "cost_column" | "customers" | "twelve_months" | "three_months" | "two_months"
  | "year_ago" | "complete_month" | "not_burning" | "revenue";
export type Fig<T> = { ok: true; value: T } | { ok: false; needs: Need };

const r2 = (v: number) => Math.round(v * 100) / 100;
const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0));
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const lastDay = (period: string) => { const [y, m] = period.split("-").map(Number); return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
const dayNo = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;
/** Every month from the first to the last, gaps included (a month with no lines is a month of zero). */
function span(periods: string[]): string[] {
  if (!periods.length) return [];
  const s = [...periods].sort(), a = monthIndex(s[0]), b = monthIndex(s[s.length - 1]);
  return Array.from({ length: b - a + 1 }, (_, i) => addMonths(s[0], i));
}

/** Expense classes a Simple P&L uses. Cost of sale comes only from the Sales sheet, so an expense classed as cost of
 * sales counts as the matching operating expense (net profit is the same either way; gross margin is not invented). */
const EXP_CLASS: Partial<Record<string, PLKey>> = {
  exp_variable: "exp_variable", exp_fixed: "exp_fixed", exp_depreciation: "exp_depreciation", other_expenses: "other_expenses",
  interest_expenses: "interest_expenses", tax_expenses: "tax_expenses",
  cos_variable: "exp_variable", cos_fixed: "exp_fixed", cos_depreciation: "exp_depreciation",
};
export const simpleClass = (cls: ExpenseLine["cls"]): PLKey => (cls && EXP_CLASS[cls]) || "exp_variable";

export interface SimplePL {
  months: { period: string; P: PLCalc }[];
  total: PLCalc;
  netMargin: number | null;
  /** Gross margin needs the cost column on every sale; otherwise the share of revenue it covers. */
  grossMargin: { ok: true; value: number } | { ok: false; needs: "cost_column" | "revenue"; covered?: number };
  breakeven: BreakevenResult;
}

/** P&L by month from the lines, and for the window as a whole. `periods` keeps only those months. */
export function simplePL(sales: SalesLine[], expenses: ExpenseLine[], periods?: string[]): SimplePL {
  const keep = periods ? new Set(periods) : null;
  const S = keep ? sales.filter((l) => keep.has(l.period)) : sales;
  const E = keep ? expenses.filter((l) => keep.has(l.period)) : expenses;
  const by = new Map<string, PLInput>();
  const add = (p: string, k: PLKey, v: number) => { const m = by.get(p) ?? {}; m[k] = r2((m[k] ?? 0) + v); by.set(p, m); };
  // Costs given on a sale always count toward profit; gross margin is shown only when every sale carries one.
  for (const l of S) { add(l.period, "revenue", l.amount); if (l.cost !== null) add(l.period, "cos_variable", l.cost); }
  for (const l of E) add(l.period, simpleClass(l.cls), l.amount);
  const months = [...by.keys()].sort().map((period) => ({ period, P: plCalc(by.get(period)!) }));
  const total = plCalc(sumPL([...by.values()]));
  const revenue = sum(S.map((l) => Math.abs(l.amount)));
  const withCost = sum(S.filter((l) => l.cost !== null).map((l) => Math.abs(l.amount)));
  const grossMargin: SimplePL["grossMargin"] = !total.revenue ? { ok: false, needs: "revenue" }
    : withCost < revenue ? { ok: false, needs: "cost_column", covered: revenue ? (withCost / revenue) * 100 : 0 }
    : { ok: true, value: (total.gross_profit / total.revenue) * 100 };
  return { months, total, netMargin: total.revenue ? (total.net_income / total.revenue) * 100 : null, grossMargin, breakeven: breakeven(total) };
}

export interface CashMonth { period: string; in: number; out: number; net: number; balance: number | null }
export interface SimpleCash {
  months: CashMonth[];
  balance: Fig<number>;
  burn: Fig<number>;
  runway: Fig<number>;
  /** Lines with the paid column blank: counted as paid on their own day, and said so. */
  assumedPaid: { lines: number; amount: number };
}

/**
 * When each line moved cash: a paid line on its payment day (its own day when none is given); an unpaid line has not
 * yet; a line with the paid column blank is assumed paid on its own day. A line with only a month counts at its end.
 */
function cashDay(l: { day: string | null; period: string; paid?: boolean | null; paidOn?: string | null }): { day: string; assumed: boolean } | null {
  if (l.paid === false) return null;
  if (l.paid === true) return { day: l.paidOn ?? l.day ?? lastDay(l.period), assumed: false };
  return { day: l.day ?? lastDay(l.period), assumed: true };
}

/** Cash in and out by month, the balance from the opening cash, burn (last three complete months) and runway. */
export function cashLines(sales: SalesLine[], expenses: ExpenseLine[], opening: OpeningCash | null, asOf: string): SimpleCash {
  const moves: { day: string; amount: number }[] = [];
  const assumed = { lines: 0, amount: 0 };
  const take = (l: SalesLine | ExpenseLine, sign: 1 | -1) => {
    const c = cashDay(l);
    if (!c) return;
    if (c.assumed) { assumed.lines++; assumed.amount = r2(assumed.amount + l.amount); }
    moves.push({ day: c.day, amount: sign * l.amount });
  };
  for (const l of sales) take(l, 1);
  for (const l of expenses) take(l, -1);
  const after = (d: string) => !opening || d > opening.asOf;
  const months = span(moves.map((m) => m.day.slice(0, 7))).map((period): CashMonth => {
    const here = moves.filter((m) => m.day.slice(0, 7) === period);
    const inn = sum(here.filter((m) => m.amount > 0).map((m) => m.amount)), out = sum(here.filter((m) => m.amount < 0).map((m) => -m.amount));
    const end = lastDay(period);
    const balance = opening && end >= opening.asOf ? r2(opening.amount + sum(moves.filter((m) => after(m.day) && m.day <= end).map((m) => m.amount))) : null;
    return { period, in: inn, out, net: r2(inn - out), balance };
  });
  const current = opening ? r2(opening.amount + sum(moves.filter((m) => after(m.day) && m.day <= asOf).map((m) => m.amount))) : null;
  const complete = months.filter((m) => m.period < asOf.slice(0, 7)).slice(-3);
  const avgNet = mean(complete.map((m) => m.net));
  const burn: Fig<number> = complete.length ? { ok: true, value: avgNet < 0 ? r2(-avgNet) : 0 } : { ok: false, needs: "complete_month" };
  const runway: Fig<number> = current === null ? { ok: false, needs: "opening_cash" }
    : !burn.ok ? burn : burn.value === 0 ? { ok: false, needs: "not_burning" } : { ok: true, value: Math.max(0, current) / burn.value };
  return { months, balance: current === null ? { ok: false, needs: "opening_cash" } : { ok: true, value: current }, burn, runway, assumedPaid: assumed };
}

export interface Ageing { buckets: [number, number, number, number]; total: number; overdue90: number }
export const AGE_BUCKETS = ["0–30", "31–60", "61–90", "90+"] as const;

/** Unpaid amounts by age in days from the invoice or bill day: 0–30, 31–60, 61–90, over 90. */
export function ageByDate(items: { day: string | null; period?: string; amount: number }[], asOf: string): Ageing {
  const b: [number, number, number, number] = [0, 0, 0, 0];
  for (const it of items) {
    const d = it.day ?? (it.period ? lastDay(it.period) : asOf);
    const age = dayNo(asOf) - dayNo(d);
    const i = age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3;
    b[i] = r2(b[i] + it.amount);
  }
  return { buckets: b, total: sum(b), overdue90: b[3] };
}

const hasPaidColumn = (ls: { paid?: boolean | null }[]) => ls.some((l) => l.paid === true || l.paid === false);
const ageing = (ls: (SalesLine | ExpenseLine)[], asOf: string): Fig<Ageing> =>
  hasPaidColumn(ls) ? { ok: true, value: ageByDate(ls.filter((l) => l.paid === false), asOf) } : { ok: false, needs: "paid_column" };

const UNNAMED = new Set(["", "No customer", "Revenue journal entries (no invoice)"]);
export interface Concentration { top1: { name: string; share: number }; top5: number; customers: number }

/** The largest customer's share of revenue, and the five largest together. */
export function concentration(sales: SalesLine[]): Fig<Concentration> {
  const by = new Map<string, number>();
  for (const l of sales) if (!UNNAMED.has(l.customer.trim())) by.set(l.customer, (by.get(l.customer) ?? 0) + l.amount);
  const total = sales.reduce((s, l) => s + l.amount, 0);
  if (!by.size || total <= 0) return { ok: false, needs: "customers" };
  const ranked = [...by].sort((a, b) => b[1] - a[1]);
  return { ok: true, value: { top1: { name: ranked[0][0], share: (ranked[0][1] / total) * 100 }, top5: (ranked.slice(0, 5).reduce((s, [, v]) => s + v, 0) / total) * 100, customers: by.size } };
}

export interface Seasonality { index: number[]; peak: number; low: number }

/** Each calendar month's average ÷ the average month (1 = a usual month). Needs a year of months. */
export function seasonality(series: { period: string; value: number }[]): Fig<Seasonality> {
  if (series.length < 12) return { ok: false, needs: "twelve_months" };
  const all = mean(series.map((s) => s.value));
  if (all <= 0) return { ok: false, needs: "revenue" };
  const tot = new Array(12).fill(0), cnt = new Array(12).fill(0);
  for (const s of series) { const m = +s.period.slice(5, 7) - 1; tot[m] += s.value; cnt[m]++; }
  const index = tot.map((t, i) => (cnt[i] ? t / cnt[i] / all : 1));
  const peak = index.indexOf(Math.max(...index)) + 1, low = index.indexOf(Math.min(...index)) + 1;
  return { ok: true, value: { index, peak, low } };
}

export interface SeriesForecast {
  method: RevenueMethod; methodLabel: string; methodAbout: string;
  /** Average error when the method forecast the latest months it was not shown (%); null when too few months to test. */
  backtestError: number | null; testedMonths: number | null;
  points: { period: string; value: number; low: number; high: number }[];
}

/**
 * The next 3–6 months of a monthly series, by the Full forecast's revenue methods (trend with seasonal pattern, same
 * month last year, recent trend, recent average), the one that best predicted the latest months chosen.
 */
export function forecastSeries(series: { period: string; value: number }[], horizon: number, lang: "en" | "ar" = "en"): Fig<SeriesForecast> {
  const months = span(series.map((s) => s.period));
  if (months.length < 3) return { ok: false, needs: "three_months" };
  const by = new Map(series.map((s) => [s.period, s.value]));
  const values = months.map((p) => by.get(p) ?? 0);
  const h = Math.min(6, Math.max(3, Math.round(horizon)));
  const trials = methodTrials(values, months);
  const eligible = (Object.keys(METHOD_NEEDS) as RevenueMethod[]).filter((m) => values.length >= METHOD_NEEDS[m]);
  const best = trials?.tried[0];
  const method: RevenueMethod = best && eligible.includes(best.method) ? best.method : eligible.includes("trend") ? "trend" : "average";
  const err = best && best.method === method ? best.revenueMape : null;
  const fc = projectRevenue(method, values, months[months.length - 1], h, null);
  const points = fc.map((value, i) => {
    const w = rangeWidth(err !== null && Number.isFinite(err) ? err : null, i + 1, trials?.H ?? null);
    return { period: addMonths(months[months.length - 1], i + 1), value: r2(value), low: r2(value * (1 - w)), high: r2(value * (1 + w)) };
  });
  const ar = lang === "ar";
  return {
    ok: true,
    value: {
      method, methodLabel: (ar ? METHOD_LABEL_AR : METHOD_LABEL)[method], methodAbout: (ar ? METHOD_ABOUT_AR : METHOD_ABOUT)[method],
      backtestError: err !== null && Number.isFinite(err) ? err : null, testedMonths: trials?.H ?? null, points,
    },
  };
}

export interface SimpleInput { sales: SalesLine[]; expenses: ExpenseLine[]; openingCash: OpeningCash | null; asOf: string; horizon?: number; lang?: "en" | "ar" }
export interface SimpleSummary {
  asOf: string;
  /** The last twelve months held (the latest month with lines and the eleven before). */
  window: string[];
  pl: SimplePL;
  /** Revenue and expenses for every month held, gaps as zero. */
  monthly: { period: string; revenue: number; expenses: number; net: number }[];
  /** The latest complete month against the month before and the same month a year before (%). */
  latest: string | null;
  mom: Fig<number>;
  yoy: Fig<number>;
  cash: SimpleCash;
  receivables: Fig<Ageing>;
  payables: Fig<Ageing>;
  concentration: Fig<Concentration>;
  seasonality: Fig<Seasonality>;
  forecastRevenue: Fig<SeriesForecast>;
  forecastExpenses: Fig<SeriesForecast>;
  /** Expenses for the window by category, largest first. */
  categories: { name: string; amount: number }[];
}

const growth = (now: number | undefined, then: number | undefined, needs: Need): Fig<number> =>
  now === undefined || then === undefined ? { ok: false, needs } : !then ? { ok: false, needs: "revenue" } : { ok: true, value: ((now - then) / Math.abs(then)) * 100 };

/** Every Simple figure at once, from the lines. */
export function simpleSummary(x: SimpleInput): SimpleSummary {
  const { sales, expenses, asOf } = x;
  const all = span([...sales, ...expenses].map((l) => l.period));
  const window = all.slice(-12);
  const pl = simplePL(sales, expenses, window);
  const full = simplePL(sales, expenses);
  const byP = new Map(full.months.map((m) => [m.period, m.P]));
  const monthly = all.map((period) => {
    const P = byP.get(period);
    return { period, revenue: P?.revenue ?? 0, expenses: P ? r2(P.revenue - P.net_income) : 0, net: P?.net_income ?? 0 };
  });
  const complete = monthly.filter((m) => m.period < asOf.slice(0, 7));
  const latest = complete.length ? complete[complete.length - 1].period : null;
  const rev = new Map(monthly.map((m) => [m.period, m.revenue]));
  const keep = new Set(window);
  const cats = new Map<string, number>();
  for (const l of expenses) if (keep.has(l.period)) { const k = l.category || l.account || "Other"; cats.set(k, r2((cats.get(k) ?? 0) + l.amount)); }
  const h = x.horizon ?? 6;
  return {
    asOf, window, pl, monthly, latest,
    mom: latest ? growth(rev.get(latest), rev.get(addMonths(latest, -1)), "two_months") : { ok: false, needs: "complete_month" },
    yoy: latest ? growth(rev.get(latest), rev.get(addMonths(latest, -12)), "year_ago") : { ok: false, needs: "complete_month" },
    cash: cashLines(sales, expenses, x.openingCash, asOf),
    receivables: ageing(sales, asOf),
    payables: ageing(expenses, asOf),
    concentration: concentration(sales.filter((l) => keep.has(l.period))),
    seasonality: seasonality(complete.map((m) => ({ period: m.period, value: m.revenue }))),
    forecastRevenue: forecastSeries(complete.map((m) => ({ period: m.period, value: m.revenue })), h, x.lang),
    forecastExpenses: forecastSeries(complete.map((m) => ({ period: m.period, value: m.expenses })), h, x.lang),
    categories: [...cats].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  };
}

/** Three to five plain sentences, each with its numbers: what the owner should know first. */
export function simpleFindings(s: SimpleSummary, cur: string, lang: "en" | "ar" = "en"): string[] {
  const ar = lang === "ar";
  const L = (en: string, a: string) => (ar ? a : en);
  const m = (v: number) => money(v, cur);
  const ml = (p: string) => monthLabel(p, lang);
  const out: string[] = [];
  const t = s.pl.total;
  if (!s.window.length) return out;
  const span12 = `${ml(s.window[0])} – ${ml(s.window[s.window.length - 1])}`;
  let rev = L(`Revenue was ${m(t.revenue)} over ${span12}.`, `بلغت الإيرادات ${m(t.revenue)} خلال ${span12}.`);
  if (s.latest && s.mom.ok) rev += L(` ${ml(s.latest)} was ${pct(s.mom.value, 1)}% against the month before`, ` ${ml(s.latest)} ${pct(s.mom.value, 1)}% مقارنة بالشهر السابق`)
    + (s.yoy.ok ? L(` and ${pct(s.yoy.value, 1)}% against a year earlier.`, ` و${pct(s.yoy.value, 1)}% مقارنة بالعام السابق.`) : ".");
  out.push(rev);
  out.push(L(`Net profit was ${m(t.net_income)}, a ${pct(s.pl.netMargin, 1)}% margin`, `صافي الربح ${m(t.net_income)}، بهامش ${pct(s.pl.netMargin, 1)}%`)
    + (s.pl.grossMargin.ok ? L(`; gross margin ${pct(s.pl.grossMargin.value, 1)}%.`, `؛ ومجمل الربح ${pct(s.pl.grossMargin.value, 1)}%.`) : "."));
  const c = s.cash;
  if (c.runway.ok && c.burn.ok) out.push(L(`Cash is ${m((c.balance as { value: number }).value)} and falls by about ${m(c.burn.value)} a month: about ${c.runway.value.toFixed(1)} months of runway.`, `النقدية ${m((c.balance as { value: number }).value)} وتنقص نحو ${m(c.burn.value)} شهريًا: تكفي نحو ${c.runway.value.toFixed(1)} شهر.`));
  else if (c.burn.ok && c.burn.value === 0) {
    const last3 = c.months.filter((x) => x.period < s.asOf.slice(0, 7)).slice(-3);
    out.push(L(`More cash came in than went out over the last ${last3.length} complete months (${m(sum(last3.map((x) => x.net)))} net).`, `دخلت نقدية أكثر مما خرجت في آخر ${last3.length} شهور كاملة (صافي ${m(sum(last3.map((x) => x.net)))}).`));
  } else if (c.burn.ok) out.push(L(`More cash goes out than comes in: about ${m(c.burn.value)} a month. Add the opening cash to see the runway.`, `النقدية الخارجة أكثر من الداخلة: نحو ${m(c.burn.value)} شهريًا. أضف النقدية الافتتاحية لمعرفة المدة المتبقية.`));
  if (s.concentration.ok && s.concentration.value.top1.share >= 30) {
    const k = s.concentration.value;
    out.push(L(`${k.top1.name} gives ${pct(k.top1.share, 1)}% of revenue; the top five give ${pct(k.top5, 1)}%.`, `${k.top1.name} يمثل ${pct(k.top1.share, 1)}% من الإيرادات؛ وأكبر خمسة عملاء ${pct(k.top5, 1)}%.`));
  }
  if (s.receivables.ok) {
    const a = s.receivables.value, late = r2(a.buckets[2] + a.buckets[3]);
    if (late > 0) out.push(L(`${m(late)} of unpaid sales is over 60 days old (of ${m(a.total)} unpaid).`, `${m(late)} من المبيعات غير المحصلة عمرها أكثر من 60 يومًا (من ${m(a.total)} غير محصلة).`));
  }
  if (s.categories.length) {
    const top = s.categories[0], costs = sum(s.categories.map((x) => x.amount));
    out.push(L(`${top.name} is the largest expense: ${m(top.amount)}, ${pct(costs ? (top.amount / costs) * 100 : 0, 1)}% of expenses.`, `${top.name} أكبر بند مصروفات: ${m(top.amount)}، ${pct(costs ? (top.amount / costs) * 100 : 0, 1)}% من المصروفات.`));
  }
  return out.slice(0, 5);
}

export interface SimpleDef { key: string; name: string; formula: string; about: string; ar: { name: string; formula: string; about: string } }
const def = (key: string, name: string, formula: string, about: string, ar: SimpleDef["ar"]): SimpleDef => ({ key, name, formula, about, ar });

/** The definition and formula behind every Simple figure (shown in its details). Margins reuse the Full definitions. */
export const SIMPLE_DEFS: SimpleDef[] = [
  def("revenue", "Revenue", "Revenue = Sum of the sales lines' amounts", "The value of sales recorded in the period, as entered (VAT not separated).",
    { name: "الإيرادات", formula: "الإيرادات = مجموع مبالغ سطور المبيعات", about: "قيمة المبيعات المسجلة في الفترة كما أُدخلت (دون فصل الضريبة)." }),
  def("net_profit", "Net profit", "Net profit = Revenue − Cost of sales − Expenses", "What is left from sales after every cost recorded in the two sheets.",
    { name: "صافي الربح", formula: "صافي الربح = الإيرادات − تكلفة المبيعات − المصروفات", about: "ما يتبقى من المبيعات بعد كل التكاليف المسجلة في الملفين." }),
  def("net_margin", "Net margin", "Net margin = Net profit ÷ Revenue × 100", "How much of each sale becomes profit.",
    { name: "هامش صافي الربح", formula: "هامش صافي الربح = صافي الربح ÷ الإيرادات × 100", about: "كم يتحول من كل عملية بيع إلى ربح." }),
  def("gross_margin", "Gross margin", KPI_BY_KEY.gpm.formula + " (cost of sales from the Sales sheet's cost column)", KPI_BY_KEY.gpm.about + " Shown only when every sale carries its cost.",
    { name: "هامش مجمل الربح", formula: "هامش مجمل الربح = مجمل الربح ÷ الإيرادات × 100 (التكلفة من عمود تكلفة المبيعات)", about: "نسبة الإيرادات المتبقية بعد التكاليف المباشرة للمبيعات. يظهر فقط عندما تحمل كل عملية بيع تكلفتها." }),
  def("cash", "Cash", "Cash = Opening cash + Cash in − Cash out since the opening date", "Paid lines move cash on their payment day; unpaid lines have not yet; a blank paid column counts as paid on the line's day.",
    { name: "النقدية", formula: "النقدية = النقدية الافتتاحية + النقدية الداخلة − النقدية الخارجة منذ تاريخ الافتتاح", about: "السطور المدفوعة تحرك النقدية في يوم الدفع؛ غير المدفوعة لم تحركها بعد؛ والخانة الفارغة تُعد مدفوعة في يوم السطر." }),
  def("burn", "Monthly burn", "Burn = −(Average net cash of the last 3 complete months), when negative", "How much more cash leaves than comes in each month. Zero when more comes in.",
    { name: "الحرق الشهري", formula: "الحرق = −(متوسط صافي النقدية لآخر 3 أشهر كاملة) عندما يكون سالبًا", about: "مقدار ما يخرج من نقدية أكثر مما يدخل كل شهر. صفر عندما يدخل أكثر." }),
  def("runway", "Runway", "Runway (months) = Cash ÷ Monthly burn", "How many months the cash lasts at the current burn.",
    { name: "المدة المتبقية", formula: "المدة المتبقية (شهور) = النقدية ÷ الحرق الشهري", about: "عدد الشهور التي تكفيها النقدية بمعدل الحرق الحالي." }),
  def("breakeven", "Break-even revenue", "Break-even = Fixed costs ÷ (1 − Variable costs ÷ Revenue)", "The revenue at which profit is zero, with fixed and variable costs as classed.",
    { name: "إيراد التعادل", formula: "التعادل = التكاليف الثابتة ÷ (1 − التكاليف المتغيرة ÷ الإيرادات)", about: "الإيراد الذي يكون عنده الربح صفرًا، حسب تصنيف التكاليف الثابتة والمتغيرة." }),
  def("top1", "Largest customer", "Largest customer share = Largest customer's revenue ÷ Revenue × 100", "How much of the business depends on one customer.",
    { name: "أكبر عميل", formula: "حصة أكبر عميل = إيرادات أكبر عميل ÷ الإيرادات × 100", about: "مدى اعتماد النشاط على عميل واحد." }),
  def("top5", "Top five customers", "Top-5 share = Revenue of the five largest customers ÷ Revenue × 100", "How concentrated sales are among a few customers.",
    { name: "أكبر خمسة عملاء", formula: "حصة أكبر خمسة = إيرادات أكبر خمسة عملاء ÷ الإيرادات × 100", about: "مدى تركز المبيعات في عدد قليل من العملاء." }),
  def("seasonality", "Seasonality", "Month index = Average revenue in that calendar month ÷ Average monthly revenue", "1.0 is a usual month; above 1 a busy month, below 1 a quiet one. Needs 12 months.",
    { name: "الموسمية", formula: "مؤشر الشهر = متوسط إيرادات ذلك الشهر ÷ متوسط الإيرادات الشهرية", about: "1.0 شهر عادي؛ أعلى من 1 شهر نشط، وأقل من 1 شهر هادئ. يحتاج 12 شهرًا." }),
  def("receivables", "Unpaid sales (receivables)", "Receivables = Sum of sales marked unpaid, aged from the sale day", "Money customers still owe, in 0–30, 31–60, 61–90 and over 90 days.",
    { name: "مبيعات غير محصلة (مدينون)", formula: "المدينون = مجموع المبيعات غير المدفوعة، بعمرها من يوم البيع", about: "ما يدين به العملاء، في 0–30 و31–60 و61–90 وأكثر من 90 يومًا." }),
  def("payables", "Unpaid expenses (payables)", "Payables = Sum of expenses marked unpaid, aged from the bill day", "Money still owed to suppliers, in the same age bands.",
    { name: "مصروفات غير مدفوعة (دائنون)", formula: "الدائنون = مجموع المصروفات غير المدفوعة، بعمرها من يوم الفاتورة", about: "ما يُدان به للموردين، بنفس فئات العمر." }),
  def("forecast", "Forecast", "Each month = the method that best predicted the latest months it was not shown", "Trend with seasonal pattern, same month last year, recent trend or recent average; the range widens with distance.",
    { name: "التوقعات", formula: "كل شهر = الطريقة التي تنبأت بأحدث الأشهر بأقل خطأ دون أن تراها", about: "اتجاه مع نمط موسمي، أو نفس الشهر من العام الماضي، أو الاتجاه الأخير، أو المتوسط الأخير؛ ويتسع النطاق مع البعد." }),
];
export const SIMPLE_DEF = Object.fromEntries(SIMPLE_DEFS.map((d) => [d.key, d])) as Record<string, SimpleDef>;
