import { addMonths, daysIn, mlabel, MONTH_ABBR, monthIndex, parsePeriod, periodFromIndex } from "./format";
import { bsCalc, plCalc, sumPL } from "./statements";
import type { BSCalc, MonthData, PeriodType, PLCalc } from "./types";

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
  /** All periods in the window are loaded. */
  complete: boolean;
  P: PLCalc;
  B: BSCalc;
  B0: BSCalc | null;
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

export function periodView(months: MonthData[], sel: PeriodSel, fyStart: number): PeriodView {
  const { sorted, byPeriod } = indexMonths(months);
  const window = windowFor(sel, fyStart);
  const got = window.periods.map((p) => byPeriod.get(p)).filter(Boolean) as MonthData[];
  const endMonth = byPeriod.get(window.end);
  if (!endMonth) throw new Error(`No data for ${window.end}`);
  const P = plCalc(sumPL(got.map((m) => m.pl)));
  const B = bsCalc(endMonth.bs);
  const open = byPeriod.get(addMonths(window.start, -1));
  const B0 = open ? bsCalc(open.bs) : null;
  const days = window.periods.reduce((s, p) => s + daysIn(p), 0);
  const cmp = (shift: number) => {
    const w2 = shiftWindow(window, shift);
    const ms = w2.periods.map((p) => byPeriod.get(p));
    if (ms.some((x) => !x)) return null;
    return { P: plCalc(sumPL(ms.map((m) => m!.pl))), B: bsCalc(ms[ms.length - 1]!.bs), label: windowLabel(w2, sel.type, fyStart) };
  };
  const fy0 = fyStartOf(window.end, fyStart);
  const ytdMonths = sorted.filter((m) => m.period >= fy0 && m.period <= window.end);
  const upto = sorted.filter((m) => m.period <= window.end);
  return {
    sel, window, complete: got.length === window.periods.length, P, B, B0, days,
    prior: cmp(SHIFT[sel.type]), ly: sel.type === "year" ? cmp(12) : cmp(12),
    ytd: plCalc(sumPL(ytdMonths.map((m) => m.pl))),
    series: { periods: upto.map((m) => m.period), P: upto.map((m) => plCalc(m.pl)), B: upto.map((m) => bsCalc(m.bs)) },
  };
}

/** Periods selectable in the picker for a given type. */
export function selectableEnds(months: MonthData[], type: PeriodType, fyStart: number): { end: string; label: string }[] {
  const ps = indexMonths(months).sorted.map((m) => m.period);
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
