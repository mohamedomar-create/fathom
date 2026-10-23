import { describe, expect, it } from "vitest";
import { simpleSteps } from "@/lib/company/data-steps";

const base = { basePath: "/company/x", openingCash: null, sales: [] as string[], expenses: [] as string[] };

describe("Simple mode Data steps: settings, Sales sheet, Expenses sheet", () => {
  it("three steps, nothing loaded", () => {
    const s = simpleSteps(base);
    expect(s.map((x) => [x.id, x.status])).toEqual([["setup", "todo"], ["sales", "todo"], ["expenses", "todo"]]);
    expect(s[1].action?.href).toBe("/company/x/data/upload?step=sales");
    expect(s[2].action?.href).toBe("/company/x/data/upload?step=expenses");
  });
  it("each sheet says which months it covers once loaded; settings done once opening cash is set", () => {
    const s = simpleSteps({ ...base, openingCash: { amount: 1000, asOf: "2026-01-01" }, sales: ["2026-01", "2026-02", "2026-03"], expenses: ["2026-02"] });
    expect(s.map((x) => x.status)).toEqual(["done", "done", "done"]);
    expect(s[1].detail).toContain("Jan 2026");
    expect(s[1].detail).toContain("Mar 2026");
    expect(s[0].detail).toContain("1,000");
  });
  it("no step is ever locked: the two sheets can come in any order", () => {
    expect(simpleSteps({ ...base, expenses: ["2026-01"] }).some((x) => x.status === "locked")).toBe(false);
  });
});
