import { money, num, pct, type Unit } from "@/lib/engine";

export function niceTicks(lo: number, hi: number, n = 6): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start, i = 0; i < 60; v += step, i++) {
    ticks.push(Number(v.toPrecision(12)));
    if (v >= hi - step * 1e-9) break;
  }
  return ticks;
}

export function axisLabel(v: number, unit: Unit, cur: string) {
  if (unit === "cur") return money(v, cur, true);
  if (unit === "%") return pct(v, 0);
  if (unit === "days") return `${Math.round(v)}`;
  return num(v, unit === "ratio" ? "num" : unit, cur).replace(" times", "x");
}

export function valueLabel(v: number | null | undefined, unit: Unit, cur: string) {
  if (v === null || v === undefined) return "–";
  if (unit === "cur") return money(v, cur);
  return num(v, unit, cur);
}

export const C = { green: "#7CB46B", greenD: "#4F8A41", red: "#D9343A", ink: "#222", mute: "#8a8a85", s: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] };
