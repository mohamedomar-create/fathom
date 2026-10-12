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
  /** Months of activity the figures cover (1 to 12): the months held, or 12 for an annual column. */
  covered: number;
  /** Months inside the basis with no figures; flows are scaled up from the months held. */
  gaps: string[];
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

/** A year-end month with no other month of its financial year loaded: an annual column from audited statements. */
function isAnnualAt(held: Set<string>, p: string, fyStart: number) {
  if (parsePeriod(p).m !== ((fyStart + 10) % 12) + 1) return false;
  for (let i = 1; i <= 11; i++) if (held.has(addMonths(p, -i))) return false;
  return true;
}

export function twelveMonths(months: MonthData[], end: string, fyStart = 1): Basis {
  const { sorted, byPeriod } = indexMonths(months);
  const endMonth = byPeriod.get(end);
  if (!endMonth) throw new Error(`No data for ${end}`);
  const held = new Set(sorted.map((m) => m.period));
  const winStart = addMonths(end, -11);
  const inWindow = sorted.filter((m) => m.period >= winStart && m.period <= end);
  const annualColumn = isAnnualAt(held, end, fyStart);
  // An annual column earlier in the window holds a whole year, not one month: start after it and use it as the opening balance.
  const earlierAnnual = annualColumn ? undefined : inWindow.filter((m) => m.period !== end && isAnnualAt(held, m.period, fyStart)).pop();
  const first = earlierAnnual ? addMonths(earlierAnnual.period, 1) : sorted[0].period;
  const start = annualColumn || first <= winStart ? winStart : first;
  const used = annualColumn ? [endMonth] : inWindow.filter((m) => m.period >= start);
  const span = monthIndex(end) - monthIndex(start) + 1;
  const gaps = annualColumn ? [] : Array.from({ length: span }, (_, i) => addMonths(start, i)).filter((p) => !held.has(p));
  const covered = annualColumn ? 12 : used.length;
  const factor = 12 / covered;
  const flows = sumPL(used.map((m) => m.pl));
  const P = plCalc(flows);
  const Pa = plCalc(Object.fromEntries(Object.entries(flows).map(([k, v]) => [k, (v ?? 0) * factor])));
  const B = bsCalc(endMonth.bs);
  const open = byPeriod.get(addMonths(start, -1));
  const B0 = open ? bsCalc(open.bs) : null;
  let days = 0;
  if (annualColumn) for (let i = 0; i < 12; i++) days += daysIn(addMonths(winStart, i));
  else for (const m of used) days += daysIn(m.period);
  const points = [...(B0 ? [B0] : []), ...used.map((m) => bsCalc(m.bs))];
  const avg = (k: keyof BSCalc) => points.reduce((s, b) => s + (b[k] as number), 0) / points.length;
  const priorEnd = addMonths(end, -12);
  const priorHeld = sorted.filter((m) => m.period > addMonths(priorEnd, -12) && m.period <= priorEnd);
  const priorEndMonth = byPeriod.get(priorEnd);
  const priorOk = priorEndMonth && (priorHeld.length === 12 || isAnnualAt(held, priorEnd, fyStart));
  const prior = priorOk ? { P: plCalc(sumPL((priorHeld.length === 12 ? priorHeld : [priorEndMonth]).map((m) => m.pl))), B: bsCalc(priorEndMonth.bs) } : null;
  const gapNote = gaps.length ? ` (${gaps.length === 1 ? mlabel(gaps[0]) : `${gaps.length} months`} missing)` : "";
  return {
    end, start, covered, gaps, factor, days, P, Pa, B, B0, avg, prior, annualColumn,
    label: `${covered} month${covered > 1 ? "s" : ""} to ${mlabel(end)}${gapNote}`,
    ocf: B0 && !gaps.length ? cashFlowStatement(P, B, B0).cfo : null,
  };
}
