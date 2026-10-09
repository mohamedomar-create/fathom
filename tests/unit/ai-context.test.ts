import { describe, expect, it } from "vitest";
import sample from "../../reference/sample.json";
import { analyze, type MonthData } from "@/lib/engine";
import { buildContext, SYSTEM_PROMPT } from "@/lib/ai/context";

describe("AI commentary context", () => {
  it("contains only engine numbers, formatted, and stays compact", () => {
    const months = sample.months as MonthData[];
    const a = analyze(months, { type: "month", end: "2026-09" }, { currency: "EGP", fyStartMonth: 1, taxRate: 0.225, targets: sample.targets });
    const ctx = buildContext(a, months, { name: "Sample Trading Co", currency: "EGP", aiContext: { goals: "Grow" }, notes: [] });
    const json = JSON.stringify(ctx);
    expect(ctx.profit_and_loss.revenue).toBe("EGP 1,066,138");
    expect(ctx.period).toBe("Sep 2026");
    expect(ctx.monthly_trend_last_12).toHaveLength(12);
    expect(ctx.kpis.length).toBe(a.kpiRows.length);
    expect(json.length).toBeLessThan(20000);
    expect(SYSTEM_PROMPT).toMatch(/Question for management/);
  });
});
