import { describe, expect, it } from "vitest";
import { demoModule } from "@/lib/modules/demo";

describe("the demo company's module pages", () => {
  it("draw Purchasing from made-up rows that add up", () => {
    const d = demoModule("purchasing")!;
    expect(d.rows).toHaveLength(6);
    expect(d.summary.amount).toBeCloseTo(d.summary.periods.reduce((s, p) => s + p.amount, 0));
    expect(demoModule("sales")).toBeNull();
  });
});
