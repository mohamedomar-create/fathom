import { cashFlowStatement } from "./cashflow";
import { addMonths, daysIn, mlabel, monthIndex } from "./format";
import { indexMonths, isAnnualColumn } from "./period";
import { bsCalc, plCalc, sumPL } from "./statements";
import { hasBS, hasPL, type BSCalc, type MonthData, type PLCalc } from "./types";

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

/**
 * asOf: the last day the books cover when the end month is still in progress ("2026-10-10"): only the days covered count,
 * and the part month counts as that share of a month when flows are scaled to a year.
 */
export function twelveMonths(months: MonthData[], end: string, fyStart = 1, asOf?: string | null): Basis {
  const { sorted: all, byPeriod } = indexMonths(months);
  const endMonth = byPeriod.get(end);
  if (!endMonth) throw new Error(`No data for ${end}`);
  // Flows come from months holding a P&L; balances from months holding a balance sheet.
  const sorted = all.filter(hasPL);
  const isAnnualAt = (_held: unknown, p: string, fy: number) => isAnnualColumn(sorted, p, fy);
  const held = new Set(sorted.map((m) => m.period));
  const bsAt = (p: string) => { for (let i = all.length - 1; i >= 0; i--) if (all[i].period <= p && hasBS(all[i])) return all[i]; return undefined; };
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
  // A part month (books to the 10th) covers that share of the month.
  const partDay = !annualColumn && asOf && asOf.slice(0, 7) === end ? Number(asOf.slice(8)) : 0;
  const part = partDay > 0 && partDay < daysIn(end) ? partDay / daysIn(end) : 1;
  // Twelve months to a day inside the month: the rest of the month a year earlier is added at its share of days, so the
  // figures are a true year as recorded (16 Oct 2025 – 15 Oct 2026), never 11.5 months scaled up.
  const yearAgo = byPeriod.get(addMonths(end, -12));
  const topUp = !annualColumn && part < 1 && used.length === 12 && !gaps.length && yearAgo && hasPL(yearAgo) ? yearAgo : null;
  const covered = annualColumn ? 12 : used.length - 1 + part + (topUp ? 1 - part : 0);
  const factor = 12 / covered;
  const scaled = (pl: MonthData["pl"], f: number) => Object.fromEntries(Object.entries(pl).map(([k, v]) => [k, (v ?? 0) * f])) as MonthData["pl"];
  const flows = sumPL([...used.map((m) => m.pl), ...(topUp ? [scaled(topUp.pl, 1 - part)] : [])]);
  const P = plCalc(flows);
  const Pa = plCalc(Object.fromEntries(Object.entries(flows).map(([k, v]) => [k, (v ?? 0) * factor])));
  const B = bsCalc(bsAt(end)?.bs ?? {});
  const open = byPeriod.get(addMonths(start, -1));
  const B0 = open && hasBS(open) && hasBS(endMonth) ? bsCalc(open.bs) : null;
  let days = 0;
  if (annualColumn) for (let i = 0; i < 12; i++) days += daysIn(addMonths(winStart, i));
  else for (const m of used) days += m.period === end && part < 1 ? partDay : daysIn(m.period);
  const points = [...(B0 ? [B0] : []), ...used.filter(hasBS).map((m) => bsCalc(m.bs))];
  if (!points.length) points.push(B);
  const avg = (k: keyof BSCalc) => points.reduce((s, b) => s + (b[k] as number), 0) / points.length;
  const priorEnd = addMonths(end, -12);
  const priorHeld = sorted.filter((m) => m.period > addMonths(priorEnd, -12) && m.period <= priorEnd);
  const priorEndMonth = byPeriod.get(priorEnd);
  const priorOk = priorEndMonth && (priorHeld.length === 12 || isAnnualAt(held, priorEnd, fyStart));
  // The year before on the same days: its last month at the same share, the month before that year at the rest.
  const priorTop = topUp ? byPeriod.get(addMonths(end, -24)) : undefined;
  const priorPL = !priorOk ? null : priorHeld.length === 12 && topUp
    ? (priorTop && hasPL(priorTop) ? sumPL([...priorHeld.map((m) => (m.period === priorEnd ? scaled(m.pl, part) : m.pl)), scaled(priorTop.pl, 1 - part)]) : null)
    : sumPL((priorHeld.length === 12 ? priorHeld : [priorEndMonth]).map((m) => m.pl));
  const prior = priorPL ? { P: plCalc(priorPL), B: bsCalc(bsAt(priorEnd)?.bs ?? {}) } : null;
  const gapNote = gaps.length ? ` (${gaps.length === 1 ? mlabel(gaps[0]) : `${gaps.length} months`} missing)` : "";
  return {
    end, start, covered, gaps, factor, days, P, Pa, B, B0, avg, prior, annualColumn,
    label: `${Math.round(covered * 10) / 10} month${covered > 1 ? "s" : ""} to ${part < 1 ? `${partDay} ` : ""}${mlabel(end)}${gapNote}`,
    ocf: B0 && !gaps.length ? cashFlowStatement(P, B, B0).cfo : null,
  };
}
