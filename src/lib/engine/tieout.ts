/**
 * A module's figure checked against the General Ledger, month by month. The ledger is the master for money: a difference is
 * reported with the records behind it, never adjusted away.
 */
export type TieStatus = "ok" | "off" | "no_ledger";
/** One reference (WH/OUT/0012, LC/2026/0004…) whose module amount and ledger amount differ. */
export interface TieCause { ref: string; module: number; ledger: number; why: "module_only" | "ledger_only" | "amount_differs" }
export interface TieOut { key: string; period: string; module: number; ledger: number | null; diff: number | null; status: TieStatus; causes: TieCause[] }

/** Differences up to one pound are rounding, not a mismatch. */
export const TIE_TOLERANCE = 1;
const MAX_CAUSES = 20;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The references whose amounts differ, largest gap first. */
function causesOf(byRef: { module: Record<string, number>; ledger: Record<string, number> }): TieCause[] {
  const refs = new Set([...Object.keys(byRef.module), ...Object.keys(byRef.ledger)]);
  const out: TieCause[] = [];
  for (const ref of refs) {
    const inM = ref in byRef.module, inL = ref in byRef.ledger;
    const m = r2(byRef.module[ref] ?? 0), l = r2(byRef.ledger[ref] ?? 0);
    if (Math.abs(m - l) <= TIE_TOLERANCE) continue;
    out.push({ ref, module: m, ledger: l, why: !inL ? "module_only" : !inM ? "ledger_only" : "amount_differs" });
  }
  return out.sort((a, b) => Math.abs(b.module - b.ledger) - Math.abs(a.module - a.ledger)).slice(0, MAX_CAUSES);
}

export function tieOut(key: string, period: string, module: number, ledger: number | null, byRef?: { module: Record<string, number>; ledger: Record<string, number> }): TieOut {
  const m = r2(module);
  if (ledger === null) return { key, period, module: m, ledger: null, diff: null, status: "no_ledger", causes: [] };
  const diff = r2(m - ledger);
  const off = Math.abs(diff) > TIE_TOLERANCE;
  return { key, period, module: m, ledger: r2(ledger), diff, status: off ? "off" : "ok", causes: off && byRef ? causesOf(byRef) : [] };
}

/** The same check for each month; a month the ledger does not hold is "no_ledger". */
export function tieOutSeries(key: string, periods: string[], module: Record<string, number>, ledger: Record<string, number> | null, byRef?: (p: string) => { module: Record<string, number>; ledger: Record<string, number> }): TieOut[] {
  return periods.map((p) => tieOut(key, p, module[p] ?? 0, ledger && p in ledger ? ledger[p] : null, byRef ? byRef(p) : undefined));
}
