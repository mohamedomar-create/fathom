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

/**
 * Where this engine deliberately departs from the Python reference, to follow the standard definitions
 * (each checked by hand in engine-standards.test.ts):
 *  - working-capital days, ROCE, activity and asset turnover use average month-end balances; stock and supplier days use
 *    cost of sales before depreciation;
 *  - interest cover is EBIT ÷ interest expense (as lenders measure it);
 *  - operating cash flow follows IAS 7 with interest paid under financing, so the reference's tax shield on interest
 *    moves out of "cash tax" and adjustments move into operating: ocf = reference ocf + tax rate × net interest − adjustments.
 */
const DELIBERATE = new Set(["ar_days", "inv_days", "ap_days", "roce", "activity", "asset_turn", "int_cover", "cf_margin", "ccc"]);

describe("TypeScript engine matches the Python reference on every sample month", () => {
  for (const g of golden as any[]) {
    it(g.period, () => {
      const a = analyze(months, { type: "month", end: g.period }, settings);
      for (const [k, v] of Object.entries(g.P)) close((a.view.P as any)[k], v as number, `P.${k}`);
      for (const [k, v] of Object.entries(g.B)) close((a.view.B as any)[k], v as number, `B.${k}`);
      const shift = settings.taxRate * g.P.net_interest - g.P.adjustments;
      close(a.W!.ocf, g.W.ocf + shift, "W.ocf");
      close(a.W!.fcf, g.W.fcf + shift, "W.fcf");
      close(a.W!.ncf, g.W.ncf, "W.ncf");
      for (const [k, v] of Object.entries(g.K)) if (!DELIBERATE.has(k)) close(a.K[k], v as number | null, `K.${k}`);
      const gs = goalseekTable(a.view.P, "profit_ratio", sample.targets.profit_ratio);
      for (const row of gs) close(row.needed, g.goalseek[row.key], `goalseek ${row.key}`);
      expect(a.breakeven.ok).toBe(true);
      if (a.breakeven.ok) { close(a.breakeven.bep, g.bep, "bep"); close(a.breakeven.mos, g.mos, "mos"); }
      expect(Math.abs(a.W!.ncf - (a.W!.dcash - a.W!.ddebt))).toBeLessThan(0.5);
      expect(Math.abs(a.view.B.imbalance)).toBeLessThan(0.5);
      expect(Math.abs(a.CF!.cfo + a.CF!.cfi + a.CF!.cff + a.CF!.unreconciled - a.CF!.dcash)).toBeLessThan(0.5);
      close(a.W!.ocf, a.CF!.cfo, "one operating cash flow");
    });
  }
});
