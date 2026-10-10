import { cashFlowStatement } from "./cashflow";
import { addMonths, daysIn, mlabel, monthIndex, parsePeriod } from "./format";
import { indexMonths } from "./period";
import { bsCalc, plCalc, sumPL } from "./statements";
import type { BSCalc, MonthData, PLCalc } from "./types";

/**
 * The twelve months to a chosen month: the basis lenders use (a full year, or trailing twelve months).
 * When the books start inside the window, the months held are used and annual figures are scaled up, and the basis says so.
 */
export interface Basis {
  end: string;
  start: string;
  /** "12 months to Jun 2026", or "5 months to Jun 2026" when the books start later. */
  label: string;
  /** Months of activity the figures cover (1 to 12). */
  covered: number;
  /** 12 ÷ covered: what flows are multiplied by to read as a year. */
  factor: number;
  days: number;
  /** Flows for the months covered, as recorded. */
  P: PLCalc;
  /** The same flows scaled to a year. */
  Pa: PLCalc;
  B: BSCalc;
  /** Balance sheet the month before the window; null when the books start inside it. */
  B0: BSCalc | null;
  /** Operating cash flow for the months covered (needs B0). */
  ocf: number | null;
  /** Average of the month-end balances from the opening balance to the end. */
  avg: (k: keyof BSCalc) => number;
  /** The twelve months before, when every one of them is held (or a single annual column). */
  prior: { P: PLCalc; B: BSCalc } | null;
  /** True when one column holds a whole year (audited statements). */
  annualColumn: boolean;
}

/** One loaded month at the year end with nothing else in its year: an annual column from audited statements. */
function isAnnualColumn(held: string[], end: string, fyStart: number) {
  return held.length === 1 && held[0] === end && parsePeriod(end).m === ((fyStart + 10) % 12) + 1;
}

export function twelveMonths(months: MonthData[], end: string, fyStart = 1): Basis {
  const { sorted, byPeriod } = indexMonths(months);
  const endMonth = byPeriod.get(end);
  if (!endMonth) throw new Error(`No data for ${end}`);
  const winStart = addMonths(end, -11);
  const inWindow = sorted.filter((m) => m.period >= winStart && m.period <= end);
  const first = sorted[0].period;
  const annualColumn = isAnnualColumn(inWindow.map((m) => m.period), end, fyStart);
  const start = annualColumn || first <= winStart ? winStart : first;
  const covered = monthIndex(end) - monthIndex(start) + 1;
  const factor = 12 / covered;
  const P = plCalc(sumPL(inWindow.map((m) => m.pl)));
  const Pa = plCalc(Object.fromEntries(Object.entries(sumPL(inWindow.map((m) => m.pl))).map(([k, v]) => [k, (v ?? 0) * factor])));
  const B = bsCalc(endMonth.bs);
  const open = byPeriod.get(addMonths(start, -1));
  const B0 = open ? bsCalc(open.bs) : null;
  let days = 0;
  for (let i = 0; i < covered; i++) days += daysIn(addMonths(start, i));
  const points = [...(B0 ? [B0] : []), ...inWindow.map((m) => bsCalc(m.bs))];
  const avg = (k: keyof BSCalc) => points.reduce((s, b) => s + (b[k] as number), 0) / points.length;
  const priorEnd = addMonths(end, -12);
  const priorHeld = sorted.filter((m) => m.period > addMonths(priorEnd, -12) && m.period <= priorEnd);
  const priorEndMonth = byPeriod.get(priorEnd);
  const priorOk = priorEndMonth && (priorHeld.length === 12 || isAnnualColumn(priorHeld.map((m) => m.period), priorEnd, fyStart));
  const prior = priorOk ? { P: plCalc(sumPL(priorHeld.map((m) => m.pl))), B: bsCalc(priorEndMonth.bs) } : null;
  return {
    end, start, covered, factor, days, P, Pa, B, B0, avg, prior, annualColumn,
    label: `${covered} month${covered > 1 ? "s" : ""} to ${mlabel(end)}`,
    ocf: B0 ? cashFlowStatement(P, B, B0).cfo : null,
  };
}
