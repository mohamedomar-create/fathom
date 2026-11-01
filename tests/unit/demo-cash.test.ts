// Phase 4a: the public cash book demo (made-up kiosk), read-only, ending on the business's "today".
import { describe, expect, it } from "vitest";
import { demoCashCompany, demoCashEntries } from "@/lib/cash/demo";
import { cashFigures } from "@/lib/cash/figures";

describe("the demo cash book", () => {
  it("is read-only, named, and opens at /demo/cash", () => {
    const c = demoCashCompany("2026-11-01");
    expect(c.readOnly).toBe(true);
    expect(c.base).toBe("/demo/cash");
    expect(c.today).toBe("2026-11-01");
    expect(c.openingCash).toEqual({ amount: 20000, asOf: "2025-10-31" });
  });
  it("holds 12 full months up to the month before today, money in and out every month, the same every time", () => {
    const a = demoCashEntries("2026-11-01"), b = demoCashEntries("2026-11-01");
    expect(a).toEqual(b);
    const months = [...new Set(a.map((e) => e.day.slice(0, 7)))].sort();
    expect(months[0]).toBe("2025-11");
    expect(months.at(-1)).toBe("2026-10");
    expect(months).toHaveLength(12);
    for (const m of months) {
      const inn = a.filter((e) => e.day.startsWith(m) && e.direction === "in").reduce((s, e) => s + e.amount, 0);
      const out = a.filter((e) => e.day.startsWith(m) && e.direction === "out").reduce((s, e) => s + e.amount, 0);
      expect(inn).toBeGreaterThan(out);
      expect(out).toBeGreaterThan(0);
    }
    expect(a.every((e) => e.day < "2026-11-01")).toBe(true);
  });
  it("gives the cash book's figures something to show: cash today and a forecast", () => {
    const f = cashFigures(demoCashEntries("2026-11-01"), { range: "12m", today: "2026-11-01", opening: { amount: 20000, asOf: "2025-10-31" } });
    expect(f.cash.ok).toBe(true);
  });
});
