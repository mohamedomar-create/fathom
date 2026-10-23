import { money, pct } from "@/lib/engine/format";
import { monthLabel } from "@/lib/i18n";

/**
 * The cash book's figures: money in, money out and what is left, month by month. Plain sums and averages only; nothing
 * from the big-company engine (no P&L classes, balance sheet, margins or break-even).
 */
export interface Entry { day: string; direction: "in" | "out"; amount: number; category: string; party: string; paid: boolean | null; paidOn: string | null }
export type Need = "opening_cash" | "paid_column" | "names" | "three_months" | "earlier_months" | "two_months" | "money_in";
export type Fig<T> = { ok: true; value: T } | { ok: false; needs: Need };
export type Range = "month" | "3m" | "12m" | "all";
export interface Month { period: string; in: number; out: number; net: number }
export interface Unpaid { total: number; buckets: [number, number, number, number] }

const r2 = (v: number) => Math.round(v * 100) / 100;
const idx = (p: string) => +p.slice(0, 4) * 12 + +p.slice(5, 7) - 1;
const per = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const add = (p: string, n: number) => per(idx(p) + n);
const span = (a: string, b: string) => Array.from({ length: idx(b) - idx(a) + 1 }, (_, i) => add(a, i));
const lastDay = (p: string) => { const [y, m] = p.split("-").map(Number); return `${p}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`; };
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const RANGE: Record<Range, number> = { month: 1, "3m": 3, "12m": 12, all: Infinity };

function byName(list: Entry[], key: (e: Entry) => string, blank: string) {
  const m = new Map<string, number>();
  for (const e of list) { const k = key(e).trim() || blank; m.set(k, r2((m.get(k) ?? 0) + e.amount)); }
  return [...m].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
}
function age(list: Entry[], today: string): Unpaid {
  const b: [number, number, number, number] = [0, 0, 0, 0];
  for (const e of list) { const d = days(e.day, today); const i = d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3; b[i] = r2(b[i] + e.amount); }
  return { total: r2(b[0] + b[1] + b[2] + b[3]), buckets: b };
}

export interface CashFigures {
  today: string;
  /** Every month from the first entry to the last, gaps as zero. */
  months: Month[];
  /** The months the chosen range covers (ending with the latest month that has entries). */
  periods: string[];
  total: { in: number; out: number; net: number; netPct: number | null };
  /** Money in against the same number of months just before (%). */
  change: Fig<number>;
  /** Money in against the same months a year earlier (%). */
  yearChange: Fig<number>;
  avgDay: Fig<number>;
  best: Fig<{ period: string; net: number }>;
  worst: Fig<{ period: string; net: number }>;
  inBy: { name: string; amount: number }[];
  outBy: { name: string; amount: number }[];
  parties: Fig<{ name: string; amount: number }[]>;
  cash: Fig<number>;
  balances: { period: string; balance: number }[];
  /** Entries left blank in the Paid column: counted as paid on their own day. */
  assumedPaid: number;
  unpaidIn: Fig<Unpaid>;
  unpaidOut: Fig<Unpaid>;
}

export function cashFigures(entries: Entry[], o: { opening: { amount: number; asOf: string } | null; today: string; range: Range }): CashFigures {
  const sorted = [...entries].sort((a, b) => a.day.localeCompare(b.day));
  const sum = (l: Entry[], d: "in" | "out") => r2(l.filter((e) => e.direction === d).reduce((s, e) => s + e.amount, 0));
  const first = sorted[0]?.day.slice(0, 7), last = sorted[sorted.length - 1]?.day.slice(0, 7);
  const months: Month[] = first && last ? span(first, last).map((period) => {
    const here = sorted.filter((e) => e.day.startsWith(period));
    const i = sum(here, "in"), u = sum(here, "out");
    return { period, in: i, out: u, net: r2(i - u) };
  }) : [];
  // The range ends with the latest month that has entries, never after the business's current month (a rent entry dated
  // next month does not become "the latest month").
  const thisMonth = o.today.slice(0, 7), todayDay = +o.today.slice(8, 10);
  const upTo = months.filter((m) => m.period <= thisMonth && sorted.some((e) => e.day.startsWith(m.period)));
  const anchor = upTo.length ? upTo[upTo.length - 1].period : months[months.length - 1]?.period;
  const shown = anchor ? months.filter((m) => m.period <= anchor) : [];
  const periods = shown.slice(-Math.min(shown.length, RANGE[o.range])).map((m) => m.period);
  const inRange = sorted.filter((e) => periods.includes(e.day.slice(0, 7)));
  const tIn = sum(inRange, "in"), tOut = sum(inRange, "out");
  const byP = new Map(months.map((m) => [m.period, m]));
  // A month still running is set against the same days of the month it is compared with.
  const inDays = (p: string, maxDay: number) => r2(sorted.filter((e) => e.direction === "in" && e.day.startsWith(p) && +e.day.slice(8, 10) <= maxDay).reduce((s, e) => s + e.amount, 0));
  const inOf = (ps: string[]) => (ps.every((p) => byP.has(p)) ? r2(ps.reduce((s, p, i) => s + (periods[i] === thisMonth ? inDays(p, todayDay) : byP.get(p)!.in), 0)) : null);
  const pct2 = (now: number, then: number | null, needs: Need): Fig<number> => (then === null ? { ok: false, needs } : !then ? { ok: false, needs: "money_in" } : { ok: true, value: ((now - then) / Math.abs(then)) * 100 });
  const n = periods.length;
  const before = periods.length ? Array.from({ length: n }, (_, i) => add(periods[0], i - n)) : [];
  const lastYear = periods.map((p) => add(p, -12));
  const sellDays = new Set(inRange.filter((e) => e.direction === "in").map((e) => e.day)).size;
  // Best and weakest among complete months that have entries (not the month still running, not empty gaps).
  const ranked = months.filter((m) => m.period < thisMonth && (m.in || m.out)).sort((a, b) => b.net - a.net);
  const named = inRange.filter((e) => e.direction === "in" && e.party.trim());
  const withPaid = sorted.some((e) => e.paid === true || e.paid === false);
  // Cash moves when an entry is paid: on its payment day, or its own day; an unpaid entry has not moved cash yet.
  const moves = sorted.filter((e) => e.paid !== false).map((e) => ({ day: e.paid ? e.paidOn ?? e.day : e.day, v: e.direction === "in" ? e.amount : -e.amount }));
  const counted = (to: string) => (o.opening ? r2(o.opening.amount + moves.filter((m) => m.day > o.opening!.asOf && m.day <= to).reduce((s, m) => s + m.v, 0)) : 0);
  const moveMonths = moves.filter((m) => m.day <= o.today).map((m) => m.day.slice(0, 7)).sort();
  const balances = o.opening && moveMonths.length
    ? span(moveMonths[0] < o.opening.asOf.slice(0, 7) ? o.opening.asOf.slice(0, 7) : moveMonths[0], moveMonths[moveMonths.length - 1]).filter((p) => lastDay(p) >= o.opening!.asOf).map((p) => ({ period: p, balance: counted(lastDay(p) < o.today ? lastDay(p) : o.today) }))
    : [];
  return {
    today: o.today, months, periods,
    total: { in: tIn, out: tOut, net: r2(tIn - tOut), netPct: tIn ? ((tIn - tOut) / tIn) * 100 : null },
    change: n ? pct2(tIn, inOf(before), "earlier_months") : { ok: false, needs: "two_months" },
    yearChange: n ? pct2(tIn, inOf(lastYear), "earlier_months") : { ok: false, needs: "two_months" },
    avgDay: sellDays ? { ok: true, value: tIn / sellDays } : { ok: false, needs: "money_in" },
    best: ranked.length >= 2 ? { ok: true, value: { period: ranked[0].period, net: ranked[0].net } } : { ok: false, needs: "two_months" },
    worst: ranked.length >= 2 ? { ok: true, value: { period: ranked[ranked.length - 1].period, net: ranked[ranked.length - 1].net } } : { ok: false, needs: "two_months" },
    inBy: byName(inRange.filter((e) => e.direction === "in"), (e) => e.category, "Other"),
    outBy: byName(inRange.filter((e) => e.direction === "out"), (e) => e.category, "Other"),
    parties: named.length ? { ok: true, value: byName(named, (e) => e.party, "") } : { ok: false, needs: "names" },
    cash: o.opening ? { ok: true, value: counted(o.today) } : { ok: false, needs: "opening_cash" },
    balances,
    assumedPaid: sorted.filter((e) => e.paid === null).length,
    unpaidIn: withPaid ? { ok: true, value: age(sorted.filter((e) => e.direction === "in" && e.paid === false), o.today) } : { ok: false, needs: "paid_column" },
    unpaidOut: withPaid ? { ok: true, value: age(sorted.filter((e) => e.direction === "out" && e.paid === false), o.today) } : { ok: false, needs: "paid_column" },
  };
}

export interface Forecast { method: "average" | "last_year"; points: Month[] }

/**
 * The next three months. With a year of complete months: the same month last year, grown by how the last three months
 * compare with the same three a year before. Otherwise: the average of the last three complete months.
 */
export function cashForecast(months: Month[], today: string): Fig<Forecast> {
  const done = months.filter((m) => m.period < today.slice(0, 7));
  if (done.length < 3) return { ok: false, needs: "three_months" };
  const by = new Map(done.map((m) => [m.period, m]));
  const recent = done.slice(-3);
  const avg = (k: "in" | "out") => recent.reduce((s, m) => s + m[k], 0) / 3;
  const yearAgo = recent.map((m) => by.get(add(m.period, -12)));
  const seasonal = done.length >= 12 && yearAgo.every(Boolean);
  const factor = (k: "in" | "out") => { const then = yearAgo.reduce((s, m) => s + (m?.[k] ?? 0), 0); return then > 0 ? recent.reduce((s, m) => s + m[k], 0) / then : null; };
  const value = (p: string, k: "in" | "out") => {
    const f = factor(k), ly = by.get(add(p, -12));
    return seasonal && f !== null && ly ? ly[k] * f : avg(k);
  };
  // From the business's current month on; left over is always money in − money out.
  const points = [0, 1, 2].map((i) => { const p = add(today.slice(0, 7), i); const vi = value(p, "in"), vo = value(p, "out"); return { period: p, in: vi, out: vo, net: vi - vo }; });
  return { ok: true, value: { method: seasonal ? "last_year" : "average", points } };
}

/** Three to five plain sentences, each with its numbers. */
export function cashSummary(f: CashFigures, cur: string, lang: "en" | "ar" = "en"): string[] {
  if (!f.months.length) return [];
  const ar = lang === "ar";
  const L = (en: string, a: string) => (ar ? a : en);
  const m = (v: number) => money(v, cur);
  const ml = (p: string) => monthLabel(p, lang);
  const when = f.periods.length === 1 ? ml(f.periods[0]) : `${ml(f.periods[0])} – ${ml(f.periods[f.periods.length - 1])}`;
  const out: string[] = [];
  out.push(L(`${when}: ${m(f.total.in)} came in and ${m(f.total.out)} went out, leaving ${m(f.total.net)}`, `${when}: دخل ${m(f.total.in)} وخرج ${m(f.total.out)}، والمتبقي ${m(f.total.net)}`)
    + (f.total.netPct !== null ? L(` (${pct(f.total.netPct, 1)} of money in).`, ` (${pct(f.total.netPct, 1)} من الداخل).`) : "."));
  if (f.change.ok) out.push(L(`Money in was ${pct(f.change.value, 1)} against the period before.`, `الداخل ${pct(f.change.value, 1)} مقارنة بالفترة السابقة.`));
  if (f.avgDay.ok) out.push(L(`On an average selling day ${m(f.avgDay.value)} came in.`, `في يوم البيع المتوسط دخل ${m(f.avgDay.value)}.`));
  if (f.cash.ok) out.push(L(`Cash today: ${m(f.cash.value)}.`, `النقدية اليوم: ${m(f.cash.value)}.`));
  if (f.outBy.length && f.total.out) out.push(L(`The largest spending is ${f.outBy[0].name}: ${m(f.outBy[0].amount)} (${pct((f.outBy[0].amount / f.total.out) * 100, 0)} of money out).`, `أكبر بند صرف ${f.outBy[0].name}: ${m(f.outBy[0].amount)} (${pct((f.outBy[0].amount / f.total.out) * 100, 0)} من الخارج).`));
  if (out.length < 5 && f.best.ok && f.worst.ok) out.push(L(`Best month ${ml(f.best.value.period)} (${m(f.best.value.net)} left); weakest ${ml(f.worst.value.period)} (${m(f.worst.value.net)}).`, `أفضل شهر ${ml(f.best.value.period)} (المتبقي ${m(f.best.value.net)})؛ وأضعفه ${ml(f.worst.value.period)} (${m(f.worst.value.net)}).`));
  return out.slice(0, 5);
}

export interface CashDef { key: string; name: string; formula: string; ar: { name: string; formula: string } }
const d = (key: string, name: string, formula: string, arName: string, arFormula: string): CashDef => ({ key, name, formula, ar: { name: arName, formula: arFormula } });
/** What each figure is, in one line. */
export const CASH_DEFS: CashDef[] = [
  d("in", "Money in", "Money in = sum of every entry marked in", "الداخل", "الداخل = مجموع كل حركة داخلة"),
  d("out", "Money out", "Money out = sum of every entry marked out", "الخارج", "الخارج = مجموع كل حركة خارجة"),
  d("net", "Left over", "Left over = Money in − Money out", "المتبقي", "المتبقي = الداخل − الخارج"),
  d("netPct", "Kept from each 100", "Kept = Left over ÷ Money in × 100", "المتبقي من كل 100", "المتبقي من كل 100 = المتبقي ÷ الداخل × 100"),
  d("avgDay", "Average selling day", "Average day = Money in ÷ days with money in", "متوسط يوم البيع", "متوسط اليوم = الداخل ÷ عدد الأيام التي بها دخل"),
  d("cash", "Cash today", "Cash = Opening cash + money in − money out since that day (unpaid entries not yet)", "النقدية اليوم", "النقدية = النقدية الافتتاحية + الداخل − الخارج منذ ذلك اليوم (دون غير المدفوع)"),
  d("change", "Change", "Change = (Money in now − Money in for the same number of months before) ÷ before × 100", "التغير", "التغير = (الداخل الآن − الداخل لنفس عدد الأشهر السابقة) ÷ السابق × 100"),
  d("forecast", "Next 3 months", "Average of the last 3 complete months; with a year of months, last year's same month × (last 3 months ÷ the same 3 a year before)", "الأشهر الثلاثة القادمة", "متوسط آخر 3 أشهر كاملة؛ ومع سنة من الأشهر: نفس الشهر من العام الماضي × (آخر 3 أشهر ÷ نفس الأشهر قبل عام)"),
  d("unpaid", "Not yet paid", "Entries marked unpaid, by days since their date: 0–30, 31–60, 61–90, over 90", "غير المدفوع", "الحركات غير المدفوعة حسب الأيام منذ تاريخها: 0–30، 31–60، 61–90، أكثر من 90"),
];
export const CASH_DEF = Object.fromEntries(CASH_DEFS.map((x) => [x.key, x])) as Record<string, CashDef>;
