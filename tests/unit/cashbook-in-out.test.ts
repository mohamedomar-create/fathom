import { describe, expect, it } from "vitest";
import { readCashBook as readFullCashBook } from "@/lib/ingest/cashbook";
import { readCashBook as readCash } from "@/lib/cash/read";

// The commonest shop layout: one list, a money-in and a money-out column (panel C03: the full upload read it as all costs).
const shop = (h: string[]) => [h,
  ["2026-03-01", "Counter sales", 400, null], ["2026-03-02", "Rent", null, 150], ["2026-03-03", "Counter sales", 500, null],
  ["2026-03-04", "Electricity", null, 90], ["2026-03-05", "Counter sales", 350, null], ["2026-03-06", "Bags", null, 50]];
const sum = (ls: { amount: number }[]) => ls.reduce((a, l) => a + l.amount, 0);

describe("a money in / money out cash book in the full upload", () => {
  it.each([
    [["Date", "Description", "Money in", "Money out"]],
    [["Date", "Description", "In", "Out"]],
    [["Date", "Details", "Cash in (EGP)", "Cash out (EGP)"]],
    [["التاريخ", "البيان", "وارد", "منصرف"]],
    [["التاريخ", "البيان", "مقبوضات", "مدفوعات"]],
  ])("%j reads money in as sales and money out as costs, as the cash book does", (h) => {
    const r = readFullCashBook({ name: "Cash", rows: shop(h) as never })!;
    expect(r).not.toBeNull();
    expect(sum(r.sales)).toBe(1250);
    expect(sum(r.expenses)).toBe(290);
    expect(r.layout.errors).toEqual([]);
    const c = readCash([{ name: "Cash", rows: shop(h) as never }]).sheets[0];
    expect(sum(c.entries.filter((e) => e.direction === "in"))).toBe(1250);
    expect(sum(c.entries.filter((e) => e.direction === "out"))).toBe(290);
  });

  it("a column headed like money in that ends up with nothing read as money in is a problem to fix, never all good", () => {
    const rows = [["Date", "Description", "Money in", "Rent", "Power"], ["2026-03-01", "Week 1", "", 100, 20], ["2026-03-08", "Week 2", "", 100, 25], ["2026-03-15", "Week 3", "", 100, 30]];
    const r = readFullCashBook({ name: "Cash", rows: rows as never });
    if (r) {
      expect(sum(r.sales)).toBe(0);
      expect(r.layout.errors.map((e) => e.message).join(" ")).toMatch(/money in/i);
    }
  });
});
