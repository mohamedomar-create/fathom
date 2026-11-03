import { describe, expect, it } from "vitest";
import { bridgeSteps, bulletScale, heatGrid, heatLevel, pareto, sameMonthLastYear, treemap } from "@/lib/viz/geometry";

describe("bridgeSteps", () => {
  it("runs from the opening total through each step to the closing total", () => {
    const s = bridgeSteps([
      { label: "Opening", value: 100, total: true },
      { label: "In", value: 50 },
      { label: "Out", value: -30 },
      { label: "Closing", value: 120, total: true },
    ]);
    expect(s.map((x) => [x.from, x.to, x.kind])).toEqual([[0, 100, "total"], [100, 150, "up"], [150, 120, "down"], [0, 120, "total"]]);
  });
  it("flags a closing total that does not equal the running sum", () => {
    const s = bridgeSteps([{ label: "A", value: 10, total: true }, { label: "B", value: 5 }, { label: "C", value: 20, total: true }]);
    expect(s[2].gap).toBe(5);
  });
});

describe("pareto", () => {
  it("sorts by value, gives shares and the running share, and folds the rest into Other", () => {
    const p = pareto([{ key: "c", value: 10 }, { key: "a", value: 60 }, { key: "b", value: 30 }, { key: "d", value: 0 }], 2);
    expect(p.items.map((i) => i.key)).toEqual(["a", "b"]);
    expect(p.items.map((i) => Math.round(i.cum))).toEqual([60, 90]);
    expect(p.other).toEqual({ value: 10, share: 10, count: 1 });
    expect(p.at80).toBe(1);
  });
  it("is empty with no positive total", () => {
    expect(pareto([{ key: "x", value: 0 }], 5).items).toEqual([]);
  });
});

describe("heatGrid", () => {
  it("places each month in its year row and calendar column, gaps as null", () => {
    const g = heatGrid(["2025-11", "2025-12", "2026-01", "2026-03"], [1, 2, 3, 4]);
    expect(g.years).toEqual(["2025", "2026"]);
    expect(g.cells[0][10]).toBe(1);
    expect(g.cells[0][11]).toBe(2);
    expect(g.cells[1][0]).toBe(3);
    expect(g.cells[1][1]).toBeNull();
    expect(g.cells[1][2]).toBe(4);
    expect([g.lo, g.hi]).toEqual([1, 4]);
  });
});

describe("heatLevel", () => {
  it("maps the range to equal steps", () => {
    expect(heatLevel(0, 0, 100, 5)).toBe(0);
    expect(heatLevel(100, 0, 100, 5)).toBe(4);
    expect(heatLevel(50, 0, 100, 5)).toBe(2);
    expect(heatLevel(7, 7, 7, 5)).toBe(2);
  });
});

describe("bulletScale", () => {
  it("puts the value and target on one scale with headroom", () => {
    const b = bulletScale(80, 100);
    expect(b.max).toBeGreaterThanOrEqual(100);
    expect(b.valuePct).toBeCloseTo((80 / b.max) * 100);
    expect(b.targetPct).toBeCloseTo((100 / b.max) * 100);
  });
  it("never goes past 100% and handles no target", () => {
    const b = bulletScale(150, null);
    expect(b.valuePct).toBeLessThanOrEqual(100);
    expect(b.targetPct).toBeNull();
  });
});

describe("treemap", () => {
  it("fills the box exactly and keeps each tile's area in proportion", () => {
    const t = treemap([{ key: "a", value: 6 }, { key: "b", value: 3 }, { key: "c", value: 1 }], 100, 50);
    const area = t.reduce((s, r) => s + r.w * r.h, 0);
    expect(area).toBeCloseTo(5000, 3);
    const a = t.find((r) => r.key === "a")!;
    expect((a.w * a.h) / 5000).toBeCloseTo(0.6, 3);
    for (const r of t) { expect(r.x).toBeGreaterThanOrEqual(-1e-9); expect(r.x + r.w).toBeLessThanOrEqual(100 + 1e-6); expect(r.y + r.h).toBeLessThanOrEqual(50 + 1e-6); }
  });
  it("leaves out zero and negative items", () => {
    expect(treemap([{ key: "a", value: 0 }, { key: "b", value: -2 }], 10, 10)).toEqual([]);
  });
});

describe("sameMonthLastYear", () => {
  it("puts each month's value from a year before under it, null where there is none", () => {
    const periods = ["2025-07", "2025-08", "2026-07", "2026-08"];
    expect(sameMonthLastYear(periods, [1, 2, 3, 4], ["2026-07", "2026-08"])).toEqual([1, 2]);
    expect(sameMonthLastYear(periods, [1, 2, 3, 4], ["2025-08", "2026-08"])).toEqual([null, 2]);
  });
});
