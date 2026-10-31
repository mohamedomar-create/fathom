// Phase 3a: switching a cash book to the full system builds a cash-basis set of books from it, so Financials and the
// dashboard work at once. Money is counted when it moves: unpaid credit sales and bills stay out until paid.
import { describe, expect, it } from "vitest";
import { cashBooks } from "@/lib/cash/books";
import { buildMonths } from "@/lib/company/build";
import { bsCalc, plCalc } from "@/lib/engine";
import type { Entry } from "@/lib/cash/figures";
import type { AccountLine } from "@/lib/company/types";

const e = (day: string, direction: "in" | "out", amount: number, kind: Entry["kind"], o: Partial<Entry> = {}): Entry =>
  ({ day, direction, amount, category: "", party: "", paid: null, paidOn: null, kind, ...o });

const entries: Entry[] = [
  e("2026-01-05", "in", 1000, "sale"),
  e("2026-01-06", "out", 300, "expense", { category: "Rent" }),
  e("2026-01-07", "out", 200, "purchase"),
  e("2026-01-08", "in", 5000, "capital"),
  e("2026-01-09", "out", 2000, "asset"),
  e("2026-02-02", "in", 500, "sale", { paid: false }),
  e("2026-01-20", "in", 400, "collection", { paid: true, paidOn: "2026-02-03" }),
  e("2026-02-04", "in", 1000, "loan"),
  e("2026-02-05", "out", 100, "loan_repayment"),
  e("2026-02-06", "out", 50, "drawings"),
  e("2026-02-07", "out", 70, "transfer"),
  e("2026-03-01", "in", 999, "sale"),
];

describe("cash-basis books from a cash book", () => {
  const r = cashBooks(entries, { opening: { amount: 100, asOf: "2026-01-01" }, today: "2026-02-15" });
  const months = buildMonths(r.accounts as unknown as AccountLine[]);
  const at = (p: string) => months.find((m) => m.period === p)!;

  it("P&L counts trading money when it moves: purchases as cost of sales, expenses by category, paid-later entries in the month paid", () => {
    expect(plCalc(at("2026-01").pl)).toMatchObject({ revenue: 1000 });
    expect(at("2026-01").pl.cos_variable).toBe(200);
    expect(r.accounts.find((a) => a.name === "Rent")).toMatchObject({ cls: "exp_variable", amounts: { "2026-01": 300 } });
    // The collection was entered in January and paid in February: it counts in February.
    expect(at("2026-02").pl.revenue).toBe(400);
  });

  it("a balance sheet every month that balances: cash, equipment, loans, the owner's money and the profit kept", () => {
    const jan = bsCalc(at("2026-01").bs), feb = bsCalc(at("2026-02").bs);
    expect(jan).toMatchObject({ cash: 3600, fixed_assets: 2000, other_equity: 5100, retained_earnings: 500, ltd: 0 });
    expect(feb).toMatchObject({ cash: 4850, fixed_assets: 2000, ltd: 900, other_equity: 5050, retained_earnings: 900 });
    expect(Math.abs(jan.imbalance)).toBeLessThan(0.01);
    expect(Math.abs(feb.imbalance)).toBeLessThan(0.01);
  });

  it("unpaid credit sales and future-dated entries stay out, and the screen is told how much", () => {
    expect(r.months).toEqual(["2026-01", "2026-02"]);
    expect(r.heldOut).toEqual({ unpaidIn: 500, unpaidOut: 0 });
  });

  it("an empty cash book builds nothing", () => {
    expect(cashBooks([], { opening: null, today: "2026-02-15" }).accounts).toEqual([]);
  });
});

describe("what is still owed, carried over to Payments", () => {
  it("unpaid money in is owed to the business, unpaid money out is owed by it, each aged from its day", async () => {
    const { cashOwed } = await import("@/lib/cash/figures");
    const o = cashOwed([
      e("2026-02-10", "in", 500, "sale", { paid: false }),
      e("2025-11-01", "in", 200, "sale", { paid: false }),
      e("2026-02-01", "out", 80, "expense", { paid: false }),
      e("2026-02-01", "in", 999, "sale", { paid: true }),
    ], "2026-02-15");
    expect(o.toYou).toEqual({ total: 700, buckets: [500, 0, 0, 200] });
    expect(o.byYou).toEqual({ total: 80, buckets: [80, 0, 0, 0] });
  });
});

describe("review fixes: opening cash", () => {
  it("movements before the opening date are not counted on top of the opening cash; the P&L keeps them", () => {
    const r = cashBooks([e("2026-01-10", "in", 3000, "sale"), e("2026-02-10", "out", 1000, "expense"), e("2026-03-05", "in", 500, "sale")], { opening: { amount: 10000, asOf: "2026-03-01" }, today: "2026-03-31" });
    const months = buildMonths(r.accounts as unknown as AccountLine[]);
    const mar = bsCalc(months.find((m) => m.period === "2026-03")!.bs);
    expect(mar).toMatchObject({ cash: 10500, other_equity: 10000, retained_earnings: 500 });
    expect(Math.abs(mar.imbalance)).toBeLessThan(0.01);
    expect(months.find((m) => m.period === "2026-01")!.pl.revenue).toBe(3000);
  });
  it("an opening dated after the last movement still gives that month's balance sheet", () => {
    const r = cashBooks([e("2026-01-10", "in", 300, "sale")], { opening: { amount: 1000, asOf: "2026-02-01" }, today: "2026-03-31" });
    const feb = bsCalc(buildMonths(r.accounts as unknown as AccountLine[]).find((m) => m.period === "2026-02")!.bs);
    expect(feb.cash).toBe(1000);
  });
});

describe("switching to the full system with closed months", () => {
  it("is refused with a reason before anything is copied", async () => {
    const { fullSwitchRefusal } = await import("@/lib/cash/books");
    expect(fullSwitchRefusal("2026-06")).toMatch(/closed through Jun 2026/);
    expect(fullSwitchRefusal(null)).toBeNull();
  });
});
