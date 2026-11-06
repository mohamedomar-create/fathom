import { describe, expect, it } from "vitest";
import { moduleWindow } from "@/lib/modules/view";

const periods = [
  { period: "2025-01", amount: 100, qty: 1, rows: 1 },
  { period: "2025-02", amount: 50, qty: 2, rows: 1 },
  { period: "2026-01", amount: 200, qty: 3, rows: 2 },
  { period: "2026-02", amount: 80, qty: null, rows: 1 },
];

describe("moduleWindow: a generic module's figures for the chosen period, from its own months", () => {
  it("adds up one month and compares with the same month last year", () => {
    const w = moduleWindow(periods, { type: "month", end: "2026-01" }, 1);
    expect(w.amount).toBe(200);
    expect(w.rows).toBe(2);
    expect(w.prior).toBe(100);
    expect(w.growth).toBeCloseTo(1);
  });
  it("adds up a quarter to date and its last-year twin", () => {
    const w = moduleWindow(periods, { type: "quarter", end: "2026-02" }, 1);
    expect(w.amount).toBe(280);
    expect(w.qty).toBe(3);
    expect(w.prior).toBe(150);
  });
  it("has no comparison when last year is empty", () => {
    const w = moduleWindow([{ period: "2026-03", amount: 5, qty: null, rows: 1 }], { type: "month", end: "2026-03" }, 1);
    expect(w.prior).toBeNull();
    expect(w.growth).toBeNull();
  });
  it("snapshot modules take the latest month in the window, never a sum", () => {
    const w = moduleWindow(periods, { type: "quarter", end: "2026-02" }, 1, "snapshot");
    expect(w.amount).toBe(80);
    expect(w.prior).toBe(50);
  });
});

import { moduleEnd, snapshotRange } from "@/lib/modules/view";
describe("moduleEnd: the server opens the same month the page's own picker does", () => {
  const own = ["2026-08", "2026-09", "2026-10"];
  it("a month the module holds is kept", () => expect(moduleEnd(own, "2026-09")).toBe("2026-09"));
  it("a month it doesn't hold, a bad month, or none: its latest month", () => {
    expect(moduleEnd(own, "2025-01")).toBe("2026-10");
    expect(moduleEnd(own, "2026-13")).toBe("2026-10");
    expect(moduleEnd(own, null)).toBe("2026-10");
  });
  it("no months yet: nothing", () => expect(moduleEnd([], "2026-10")).toBeNull());
});

describe("snapshotRange: a list held at month ends is read at one month, never added up", () => {
  const own = ["2026-01", "2026-02", "2026-03", "2026-05"];
  const year = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
  it("a flow module reads the whole window", () => expect(snapshotRange(year, own, "flow")).toEqual({ from: "2026-01", to: "2026-06" }));
  it("a snapshot reads the latest month it holds inside the window", () => expect(snapshotRange(year, own, "snapshot")).toEqual({ from: "2026-05", to: "2026-05" }));
  it("a snapshot with no month in the window reads nothing from it", () => expect(snapshotRange(["2027-01"], own, "snapshot")).toEqual({ from: "2027-01", to: "2027-01" }));
});
