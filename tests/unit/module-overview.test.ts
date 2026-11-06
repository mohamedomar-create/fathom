import { describe, expect, it } from "vitest";
import { moduleOverview } from "@/lib/company/module-overview";
import { EMPTY_EXPENSES } from "@/lib/engine/expenses";
import { EMPTY_PAYMENTS } from "@/lib/engine/payments";
import { EMPTY_SALES } from "@/lib/engine/sales";

const sales = { ...EMPTY_SALES, customers: [
  { p: "2026-01", c: "A", s: "INV", sp: "", a: 100, k: null, ka: null, q: null, d: 1, n: 1 },
  { p: "2026-02", c: "A", s: "INV", sp: "", a: 40, k: null, ka: null, q: null, d: 1, n: 1 },
  { p: "2026-02", c: "B", s: "INV", sp: "", a: 60, k: null, ka: null, q: null, d: 1, n: 1 },
] };

describe("moduleOverview: the company home without books lists each module that holds data", () => {
  it("shows only modules with data, each with its latest month and amount", () => {
    const cards = moduleOverview({ sales, expenses: EMPTY_EXPENSES, payments: EMPTY_PAYMENTS, stockMonths: [], generic: [] });
    expect(cards.map((c) => c.key)).toEqual(["sales"]);
    expect(cards[0]).toMatchObject({ months: 2, latest: "2026-02", amount: 100 });
  });
  it("lists stock by its months and generic modules by their own totals", () => {
    const cards = moduleOverview({ sales: EMPTY_SALES, expenses: EMPTY_EXPENSES, payments: EMPTY_PAYMENTS, stockMonths: ["2026-01", "2026-03"],
      generic: [{ key: "purchasing", periods: [{ period: "2026-03", amount: 7, qty: null, rows: 1 }] }, { key: "hr", periods: [] }] });
    expect(cards.map((c) => c.key)).toEqual(["inventory", "purchasing"]);
    expect(cards[0]).toMatchObject({ months: 2, latest: "2026-03", amount: null });
    expect(cards[1]).toMatchObject({ months: 1, latest: "2026-03", amount: 7 });
  });
  it("shows receivables by their as-of total", () => {
    const payments = { ...EMPTY_PAYMENTS, aged: { receivable: { asOf: "2026-02-28", buckets: [], total: { amounts: [], total: 500 }, findings: [], items: [] } } } as never;
    const cards = moduleOverview({ sales: EMPTY_SALES, expenses: EMPTY_EXPENSES, payments, stockMonths: [], generic: [] });
    expect(cards).toEqual([expect.objectContaining({ key: "ar_open", latest: "2026-02", amount: 500 })]);
  });
});
