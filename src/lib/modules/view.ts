// A generic module's figures for one period, worked out from its own months only: it never waits for the books or for
// another module. Flow modules add up their months; snapshot modules (a headcount, an asset register) take the latest
// month in the window, because a list held at two month ends is not twice the list.
import { windowFor, type PeriodSel } from "@/lib/engine/period";

export interface PeriodTotal { period: string; amount: number; qty: number | null; rows: number }
export type Nature = "flow" | "snapshot";

const lastYear = (p: string) => `${Number(p.slice(0, 4)) - 1}${p.slice(4)}`;

function total(ps: string[], by: Map<string, PeriodTotal>, nature: Nature) {
  const have = ps.map((p) => by.get(p)).filter((x): x is PeriodTotal => !!x);
  if (!have.length) return null;
  if (nature === "snapshot") { const l = have[have.length - 1]; return { amount: l.amount, qty: l.qty, rows: l.rows }; }
  const qs = have.map((h) => h.qty).filter((q): q is number => q !== null);
  return { amount: have.reduce((s, h) => s + h.amount, 0), qty: qs.length ? qs.reduce((s, q) => s + q, 0) : null, rows: have.reduce((s, h) => s + h.rows, 0) };
}

export function moduleWindow(periods: PeriodTotal[], sel: PeriodSel, fyStart: number, nature: Nature = "flow") {
  const by = new Map(periods.map((p) => [p.period, p]));
  const w = windowFor(sel, fyStart);
  const now = total(w.periods, by, nature) ?? { amount: 0, qty: null, rows: 0 };
  const before = total(w.periods.map(lastYear), by, nature);
  const prior = before ? before.amount : null;
  return { ...now, prior, growth: prior ? (now.amount - prior) / Math.abs(prior) : null, periods: w.periods, label: w.label };
}
