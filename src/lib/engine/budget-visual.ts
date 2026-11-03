/** Small pure helpers for the budget page's visuals: the change badge and the sheet's sort. */

export interface Badge { dir: "up" | "down" | "flat"; tone: "good" | "bad" | "neutral"; pct: number | null }

/**
 * The change from this year's estimate to the new year, as a badge: up or down with the % (rounded to 0.1), good or bad.
 * For a cost (`cost` true) an increase is bad; for income it is good. Under 0.5% reads as flat.
 */
export function changeBadge(now: number, est: number, cost = false): Badge {
  if (!est) return { dir: "flat", tone: "neutral", pct: null };
  const pct = Math.round(((now - est) / Math.abs(est)) * 1000) / 10;
  if (Math.abs(pct) < 0.5) return { dir: "flat", tone: "neutral", pct: pct === 0 ? 0 : pct };
  const up = pct > 0;
  return { dir: up ? "up" : "down", tone: up !== cost ? "good" : "bad", pct };
}

export type SortKey = "name" | "amount" | "change";
export interface Sort { by: SortKey; desc: boolean }

/** A sorted copy: name (case-insensitive), amount or change %; rows with no change go last either way. */
export function sortRows<T>(rows: T[], sort: Sort | null, value: { name: (r: T) => string; amount: (r: T) => number; change: (r: T) => number | null }): T[] {
  if (!sort) return rows.slice();
  const sign = sort.desc ? -1 : 1;
  return rows.slice().sort((a, b) => {
    if (sort.by === "name") return sign * value.name(a).localeCompare(value.name(b), undefined, { sensitivity: "base" });
    if (sort.by === "amount") return sign * (value.amount(a) - value.amount(b));
    const x = value.change(a), y = value.change(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * (x - y);
  });
}
