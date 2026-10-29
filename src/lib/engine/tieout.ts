import { TIE_EGP } from "@/lib/tolerance";
/**
 * A module's figure checked against the General Ledger, month by month. The ledger is the master for money: a difference is
 * reported with the records behind it, never adjusted away.
 */
export type TieStatus = "ok" | "off" | "no_ledger";
/**
 * Why a document's stock and ledger amounts differ: a stock record with no journal entry, a journal entry on a stock
 * account with no stock record (a manual entry), the same document dated in different months in the two, or the same
 * document with a different amount (unexplained).
 */
export type CauseBucket = "no_entry" | "manual" | "date" | "amount";
/** One reference (WH/OUT/0012, LC/2026/0004…) whose module amount and ledger amount differ. */
export interface TieCause { ref: string; module: number; ledger: number; why: "module_only" | "ledger_only" | "amount_differs"; bucket?: CauseBucket }
/** buckets: the difference split by reason, over every document (causes lists only the largest). */
export interface TieOut { key: string; period: string; module: number; ledger: number | null; diff: number | null; status: TieStatus; causes: TieCause[]; buckets?: Partial<Record<CauseBucket, number>> }
type Classify = (c: Omit<TieCause, "bucket">) => CauseBucket;

/** The reason for each document, knowing every document the stock records and the ledger hold, whatever their month. */
export function stockBuckets(everModule: Set<string>, everLedger: Set<string>): Classify {
  return (c) => c.why === "module_only" ? (everLedger.has(c.ref) ? "date" : "no_entry")
    : c.why === "ledger_only" ? (everModule.has(c.ref) ? "date" : "manual")
    : "amount";
}

/** Differences up to one pound are rounding, not a mismatch (the app's one rule, src/lib/tolerance.ts). */
export const TIE_TOLERANCE = TIE_EGP;
const MAX_CAUSES = 20;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** The references whose amounts differ, largest gap first, and (with a classify) the difference totalled by reason. */
function causesOf(byRef: { module: Record<string, number>; ledger: Record<string, number> }, tolerance: number, classify?: Classify): { causes: TieCause[]; buckets?: Partial<Record<CauseBucket, number>> } {
  const refs = new Set([...Object.keys(byRef.module), ...Object.keys(byRef.ledger)]);
  const out: TieCause[] = [];
  const buckets: Partial<Record<CauseBucket, number>> = {};
  for (const ref of refs) {
    const inM = ref in byRef.module, inL = ref in byRef.ledger;
    const m = r2(byRef.module[ref] ?? 0), l = r2(byRef.ledger[ref] ?? 0);
    if (Math.abs(m - l) <= tolerance) continue;
    const c: TieCause = { ref, module: m, ledger: l, why: !inL ? "module_only" : !inM ? "ledger_only" : "amount_differs" };
    if (classify) { c.bucket = classify(c); buckets[c.bucket] = r2((buckets[c.bucket] ?? 0) + m - l); }
    out.push(c);
  }
  return { causes: out.sort((a, b) => Math.abs(b.module - b.ledger) - Math.abs(a.module - a.ledger)).slice(0, MAX_CAUSES), ...(classify ? { buckets } : {}) };
}

type ByRef = { module: Record<string, number>; ledger: Record<string, number> };

/** tolerance: one pound for money; 0 for quantities, which must match exactly. byRef may be a function: it is called only when the check is off. */
export function tieOut(key: string, period: string, module: number, ledger: number | null, byRef?: ByRef | (() => ByRef), tolerance = TIE_TOLERANCE, classify?: Classify): TieOut {
  const m = r2(module);
  if (ledger === null) return { key, period, module: m, ledger: null, diff: null, status: "no_ledger", causes: [] };
  const diff = r2(m - ledger);
  const off = Math.abs(diff) > tolerance;
  const base = { key, period, module: m, ledger: r2(ledger), diff, status: off ? "off" as const : "ok" as const };
  return off && byRef ? { ...base, ...causesOf(typeof byRef === "function" ? byRef() : byRef, tolerance, classify) } : { ...base, causes: [] };
}

/** The same check for each month; a month the ledger does not hold is "no_ledger". */
export function tieOutSeries(key: string, periods: string[], module: Record<string, number>, ledger: Record<string, number> | null, byRef?: (p: string) => { module: Record<string, number>; ledger: Record<string, number> }): TieOut[] {
  return periods.map((p) => tieOut(key, p, module[p] ?? 0, ledger && p in ledger ? ledger[p] : null, byRef ? byRef(p) : undefined));
}
