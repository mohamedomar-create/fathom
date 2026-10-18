import { addMonths, daysIn, mlabel, MONTH_ABBR, monthIndex, parsePeriod, periodFromIndex } from "./format";
import { averageBS, bsCalc, plCalc, sumPL } from "./statements";
import { hasBS, hasPL, type BSCalc, type MonthData, type PeriodType, type PLCalc } from "./types";

export interface PeriodSel { type: PeriodType; end: string }

export interface Window { start: string; end: string; periods: string[]; label: string; short: string; partial: boolean }

const SHIFT: Record<PeriodType, number> = { month: 1, quarter: 3, year: 12 };

function fyEndYear(p: string, fyStart: number) {
  const { y, m } = parsePeriod(p);
  const startYear = m >= fyStart ? y : y - 1;
  return fyStart === 1 ? startYear : startYear + 1;
}

export function fyLabel(p: string, fyStart: number) {
  return fyStart === 1 ? `${fyEndYear(p, fyStart)}` : `FY${fyEndYear(p, fyStart)}`;
}

/** Start month of the financial year containing p. */
export function fyStartOf(p: string, fyStart: number) {
  const { y, m } = parsePeriod(p);
  const sy = m >= fyStart ? y : y - 1;
  return `${sy}-${String(fyStart).padStart(2, "0")}`;
}

export function windowFor(sel: PeriodSel, fyStart: number): Window {
  const endI = monthIndex(sel.end);
  const { m } = parsePeriod(sel.end);
  if (sel.type === "month") return { start: sel.end, end: sel.end, periods: [sel.end], label: mlabel(sel.end), short: mlabel(sel.end), partial: false };
  const offset = (m - fyStart + 12) % 12;
  if (sel.type === "quarter") {
    const startI = endI - (offset % 3);
    const q = Math.floor(offset / 3) + 1;
    const partial = offset % 3 !== 2;
    const periods = Array.from({ length: endI - startI + 1 }, (_, i) => periodFromIndex(startI + i));
    const base = `Q${q} ${fyLabel(sel.end, fyStart)}`;
    return { start: periods[0], end: sel.end, periods, label: partial ? `${base} (to ${MONTH_ABBR[m]})` : base, short: base, partial };
  }
  const startI = endI - offset;
  const periods = Array.from({ length: endI - startI + 1 }, (_, i) => periodFromIndex(startI + i));
  const base = fyStart === 1 ? `Year ${fyLabel(sel.end, fyStart)}` : fyLabel(sel.end, fyStart);
  const partial = offset !== 11;
  return { start: periods[0], end: sel.end, periods, label: partial ? `${base} (to ${MONTH_ABBR[m]})` : base, short: base, partial };
}

export function shiftWindow(w: Window, months: number): Window {
  const periods = w.periods.map((p) => addMonths(p, -months));
  return { ...w, periods, start: periods[0], end: periods[periods.length - 1], label: "", short: "" };
}

export interface PeriodView {
  sel: PeriodSel;
  window: Window;
  /** A part month compared like for like: the prior period with its last month cut to the same share of days (KPIs and alerts). */
  likePrior?: { P: PLCalc; label: string } | null;
  /** Every month of the window has its P&L loaded (or one annual column covers the year). */
  complete: boolean;
  P: PLCalc;
  /** Balance sheet at the window end; when the end month has none, the latest one before it (see bsAt). */
  B: BSCalc;
  /** Month of the balance sheet in B; null when no balance sheet is loaded up to the window end. */
  bsAt: string | null;
  /** Balance sheet the month before the window starts; null when that month has none. */
  B0: BSCalc | null;
  /** What the window lacks: months without a P&L, and whether the end and opening balance sheets are missing. */
  missing: { pl: string[]; endBS: boolean; openingBS: boolean; opening: string };
  /** The window end is an annual column (audited statements): its P&L is the whole year. */
  annual: boolean;
  /** Set when the books stop inside the last month: the day they run to (days already counts only the days covered). */
  partDay?: number;
  /** Average of the month-end balances held, from the opening balance to the end (closing alone when only one is held). */
  Bavg: BSCalc;
  days: number;
  prior: { P: PLCalc; B: BSCalc; label: string } | null;
  ly: { P: PLCalc; B: BSCalc; label: string } | null;
  ytd: PLCalc;
  /** Monthly series from the first loaded month up to the end of the window. */
  series: { periods: string[]; P: PLCalc[]; B: BSCalc[] };
}

export function indexMonths(months: MonthData[]) {
  const sorted = [...months].sort((a, b) => a.period.localeCompare(b.period));
  return { sorted, byPeriod: new Map(sorted.map((m) => [m.period, m])) };
}

function windowLabel(w: Window, type: PeriodType, fyStart: number) {
  return windowFor({ type, end: w.end }, fyStart).label;
}

/** How big a month's P&L is: its revenue, or (with none) the sum of its lines. */
const plSize = (m: MonthData) => Math.abs(m.pl.revenue ?? 0) || Object.values(m.pl).reduce((s, v) => s + Math.abs(v ?? 0), 0);

/**
 * A year-end month with no other month of its financial year holding a P&L: an annual column from audited statements.
 * When monthly figures follow it, it is a whole year only if it is far larger than those months; otherwise it is simply
 * the first month of monthly data (an Odoo sync or a ledger that happens to start on a year-end month).
 */
export function isAnnualColumn(months: MonthData[], p: string, fyStart: number) {
  if (parsePeriod(p).m !== ((fyStart + 10) % 12) + 1) return false;
  const pls = months.filter(hasPL).sort((a, b) => a.period.localeCompare(b.period));
  const at = pls.find((m) => m.period === p);
  if (!at) return false;
  const held = new Set(pls.map((m) => m.period));
  for (let i = 1; i <= 11; i++) if (held.has(addMonths(p, -i))) return false;
  // Only monthly figures in the following year count (another annual column a year later is not a month).
  const after = pls.filter((m) => m.period > p && m.period < addMonths(p, 12)).slice(0, 6).map(plSize).sort((a, b) => a - b);
  if (!after.length) return true;
  const median = after[Math.floor(after.length / 2)];
  return plSize(at) > 4 * median;
}

export function periodView(months: MonthData[], selIn: PeriodSel, fyStart: number): PeriodView {
  const { sorted, byPeriod } = indexMonths(months);
  const endMonth = byPeriod.get(selIn.end);
  if (!endMonth) throw new Error(`No data for ${selIn.end}`);
  // An annual column holds a whole year: it is read as that year whichever period type was asked for.
  const annual = isAnnualColumn(sorted, selIn.end, fyStart);
  const sel: PeriodSel = annual ? { type: "year", end: selIn.end } : selIn;
  const window = windowFor(sel, fyStart);
  const plAt = (p: string) => { const m = byPeriod.get(p); return m && hasPL(m) ? m : undefined; };
  const bsAtOrBefore = (p: string) => { for (let i = sorted.length - 1; i >= 0; i--) if (sorted[i].period <= p && hasBS(sorted[i])) return sorted[i]; return undefined; };
  const got = annual ? [endMonth] : (window.periods.map(plAt).filter(Boolean) as MonthData[]);
  const P = plCalc(sumPL(got.map((m) => m.pl)));
  const bsMonth = bsAtOrBefore(window.end);
  const B = bsCalc(bsMonth?.bs ?? {});
  const opening = addMonths(window.start, -1);
  const open = byPeriod.get(opening);
  const B0 = open && hasBS(open) ? bsCalc(open.bs) : null;
  // Days the figures cover: the whole year for an annual column, otherwise only the months holding a P&L (a year with
  // three months loaded is measured on those three months).
  const days = annual ? window.periods.reduce((s, p) => s + daysIn(p), 0) : got.reduce((s, m) => s + daysIn(m.period), 0);
  const points = annual ? [] : window.periods.map((p) => byPeriod.get(p)).filter((m): m is MonthData => !!m && hasBS(m)).map((m) => bsCalc(m.bs));
  const Bavg = averageBS([...(B0 ? [B0] : []), ...(points.length ? points : [B])]);
  const cmp = (shift: number) => {
    const w2 = shiftWindow(window, shift);
    // An annual year compares with the prior year's annual column, or with all twelve of its months.
    const ms = annual && isAnnualColumn(sorted, w2.end, fyStart) ? [plAt(w2.end)] : w2.periods.map(plAt);
    if (ms.some((x) => !x)) return null;
    const b2 = bsAtOrBefore(w2.end);
    return { P: plCalc(sumPL(ms.map((m) => m!.pl))), B: bsCalc(b2?.bs ?? {}), label: windowLabel(w2, sel.type, fyStart) };
  };
  const fy0 = fyStartOf(window.end, fyStart);
  const ytdMonths = sorted.filter((m) => hasPL(m) && m.period >= fy0 && m.period <= window.end);
  // The monthly series: months holding a P&L, each with the balance sheet held at or before it.
  const upto = sorted.filter((m) => hasPL(m) && m.period <= window.end);
  return {
    sel, window, complete: got.length === (annual ? 1 : window.periods.length), P, B, bsAt: bsMonth?.period ?? null, B0, Bavg, days, annual,
    missing: { pl: annual ? [] : window.periods.filter((p) => !plAt(p)), endBS: bsMonth?.period !== window.end, openingBS: !B0, opening },
    prior: cmp(SHIFT[sel.type]), ly: cmp(12),
    ytd: plCalc(sumPL(ytdMonths.map((m) => m.pl))),
    series: { periods: upto.map((m) => m.period), P: upto.map((m) => plCalc(m.pl)), B: upto.map((m) => bsCalc((hasBS(m) ? m : bsAtOrBefore(m.period))?.bs ?? {})) },
  };
}

/** Periods selectable in the picker for a given type. */
export function selectableEnds(months: MonthData[], type: PeriodType, fyStart: number): { end: string; label: string }[] {
  return selectableEndsOf(indexMonths(months).sorted.filter(hasPL).map((m) => m.period), type, fyStart);
}

/** The same, from a list of months (oldest first): a module with its own history, such as Inventory. */
export function selectableEndsOf(ps: string[], type: PeriodType, fyStart: number): { end: string; label: string }[] {
  if (!ps.length) return [];
  const last = ps[ps.length - 1];
  if (type === "month") return ps.map((p) => ({ end: p, label: mlabel(p) }));
  const seen = new Map<string, string>();
  for (const p of ps) {
    const w = windowFor({ type, end: p }, fyStart);
    // window end = last month of that quarter/year that we have data for
    const key = w.short;
    if (!seen.has(key) || p > seen.get(key)!) seen.set(key, p);
  }
  return [...seen.entries()].map(([, end]) => ({ end, label: windowFor({ type, end }, fyStart).label })).filter((x) => x.end <= last);
}
