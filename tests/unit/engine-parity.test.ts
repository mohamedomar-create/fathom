import { describe, expect, it } from "vitest";
import golden from "../golden/golden.json";
import sample from "../../reference/sample.json";
import { analyze, goalseekTable, type MonthData } from "@/lib/engine";

const months = sample.months as MonthData[];
const settings = { currency: sample.currency, fyStartMonth: sample.fy_start_month, taxRate: sample.tax_rate, targets: sample.targets };

const close = (a: number | null | undefined, b: number | null | undefined, label: string) => {
  if (b === null || b === undefined) return expect(a ?? null, label).toBeNull();
  expect(a, label).not.toBeNull();
  expect(Math.abs((a as number) - b), `${label}: ${a} vs ${b}`).toBeLessThan(1e-6 * Math.max(1, Math.abs(b)));
};

describe("TypeScript engine matches the Python reference on every sample month", () => {
  for (const g of golden as any[]) {
    it(g.period, () => {
      const a = analyze(months, { type: "month", end: g.period }, settings);
      for (const [k, v] of Object.entries(g.P)) close((a.view.P as any)[k], v as number, `P.${k}`);
      for (const [k, v] of Object.entries(g.B)) close((a.view.B as any)[k], v as number, `B.${k}`);
      for (const [k, v] of Object.entries(g.W)) close((a.W as any)[k], v as number, `W.${k}`);
      expect(a.W!.rows.map((r) => [r.label, r.sign])).toEqual(g.rows.map((r: any) => [r[0], r[1]]));
      g.rows.forEach((r: any, i: number) => close(a.W!.rows[i].value, r[2], `row ${r[0]}`));
      for (const [k, v] of Object.entries(g.K)) close(a.K[k], v as number | null, `K.${k}`);
      for (const [k, v] of Object.entries(g.status)) expect(a.kpiRows.find((r) => r.def.key === k)?.ok ?? null, `status ${k}`).toBe(v);
      expect(a.findings.map((f) => [f.sev, f.kind, f.section, f.title, f.text])).toEqual(
        g.findings.map((f: any) => [f.sev, f.kind, f.section, f.title, f.text]),
      );
      const gs = goalseekTable(a.view.P, "profit_ratio", sample.targets.profit_ratio);
      for (const row of gs) close(row.needed, g.goalseek[row.key], `goalseek ${row.key}`);
      expect(a.breakeven.ok).toBe(true);
      if (a.breakeven.ok) { close(a.breakeven.bep, g.bep, "bep"); close(a.breakeven.mos, g.mos, "mos"); }
      expect(Math.abs(a.W!.ncf - (a.W!.dcash - a.W!.ddebt))).toBeLessThan(0.5);
      expect(Math.abs(a.view.B.imbalance)).toBeLessThan(0.5);
      expect(Math.abs(a.CF!.cfo + a.CF!.cfi + a.CF!.cff - a.CF!.dcash)).toBeLessThan(0.5);
    });
  }
});
