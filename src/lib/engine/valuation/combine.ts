import type { MethodKey, MethodResult, Range } from "./types";

/** The weighted best estimate over the methods that apply; weights of the others are shared out pro rata. */
export function combine(results: MethodResult[], weights: Partial<Record<MethodKey, number>>): Range & { weights: Partial<Record<MethodKey, number>> } {
  const applying = results.filter((r) => r.value && (weights[r.key] ?? 0) > 0);
  const total = applying.reduce((s, r) => s + (weights[r.key] ?? 0), 0);
  const used: Partial<Record<MethodKey, number>> = {};
  for (const r of results) used[r.key] = 0;
  if (!total) return { low: 0, mid: 0, high: 0, weights: used };
  let low = 0, mid = 0, high = 0;
  for (const r of applying) {
    const w = (weights[r.key] ?? 0) / total;
    used[r.key] = w;
    low += r.value!.low * w; mid += r.value!.mid * w; high += r.value!.high * w;
  }
  return { low, mid, high, weights: used };
}
