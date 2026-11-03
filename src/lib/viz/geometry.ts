/** Pure geometry for the chart kit: no React, unit-tested. */

export interface BridgeInput { label: string; value: number; total?: boolean; info?: string }
export interface BridgeStep extends BridgeInput { from: number; to: number; kind: "total" | "up" | "down"; /** A total that differs from the running sum by this much (0 when it agrees). */ gap: number }

/** A bridge (waterfall): totals stand on zero, each step starts where the last ended. */
export function bridgeSteps(rows: BridgeInput[]): BridgeStep[] {
  let run = 0, seen = false;
  return rows.map((r) => {
    if (r.total) {
      const gap = seen ? Math.round((r.value - run) * 100) / 100 : 0;
      run = r.value; seen = true;
      return { ...r, from: 0, to: r.value, kind: "total", gap };
    }
    const from = run;
    run += r.value;
    return { ...r, from, to: run, kind: r.value >= 0 ? "up" : "down", gap: 0 };
  });
}

export interface ParetoItem { key: string; value: number; label?: string }
export interface ParetoOut {
  items: (ParetoItem & { share: number; cum: number })[];
  other: { value: number; share: number; count: number } | null;
  /** Index of the item where the running share first reaches 80% (-1 when the shown items do not reach it). */
  at80: number;
  total: number;
}

/** Ranked items with their share and running share of the positive total; the rest folds into Other. */
export function pareto(list: ParetoItem[], max: number): ParetoOut {
  const pos = list.filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const total = pos.reduce((t, x) => t + x.value, 0);
  if (!total) return { items: [], other: null, at80: -1, total: 0 };
  let cum = 0;
  const items = pos.slice(0, max).map((x) => { cum += x.value; return { ...x, share: (x.value / total) * 100, cum: (cum / total) * 100 }; });
  const rest = pos.slice(max);
  const rv = rest.reduce((t, x) => t + x.value, 0);
  return { items, other: rest.length ? { value: rv, share: (rv / total) * 100, count: rest.length } : null, at80: items.findIndex((i) => i.cum >= 80 - 1e-9), total };
}

/** Month x year grid: one row per year (oldest first), 12 calendar columns; months not given are null. */
export function heatGrid(periods: string[], values: (number | null)[]) {
  const years = [...new Set(periods.map((p) => p.slice(0, 4)))].sort();
  const cells = years.map(() => Array<number | null>(12).fill(null));
  const vs: number[] = [];
  periods.forEach((p, i) => {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    cells[years.indexOf(p.slice(0, 4))][Number(p.slice(5, 7)) - 1] = v;
    vs.push(v);
  });
  return { years, cells, lo: vs.length ? Math.min(...vs) : 0, hi: vs.length ? Math.max(...vs) : 0 };
}

/** Which of `steps` equal bands a value falls in (a flat range sits in the middle band). */
export function heatLevel(v: number, lo: number, hi: number, steps = 5): number {
  if (hi === lo) return Math.floor(steps / 2);
  return Math.max(0, Math.min(steps - 1, Math.floor(((v - lo) / (hi - lo)) * steps - 1e-9)));
}

/** Value and target on one 0-based scale with ~15% headroom, as percentages of the track. */
export function bulletScale(value: number, target: number | null | undefined) {
  const top = Math.max(Math.abs(value), Math.abs(target ?? 0), 1e-9);
  const max = top * 1.15;
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  return { max, valuePct: clamp((Math.max(0, value) / max) * 100), targetPct: target === null || target === undefined ? null : clamp((target / max) * 100) };
}
