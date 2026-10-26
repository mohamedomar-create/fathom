import { describe, expect, it } from "vitest";
import { detectKind, isTradingKind } from "@/lib/cash/kinds";
import { cashFigures, type Entry } from "@/lib/cash/figures";

describe("what each cash book entry is", () => {
  it.each([
    ["in", "Counter sales", "sale"], ["in", "مبيعات اليوم", "sale"], ["in", "Owner capital", "capital"], ["in", "رأس مال", "capital"],
    ["in", "Loan from Banque Misr", "loan"], ["in", "قرض من البنك", "loan"], ["in", "Collection from Hala (March invoice)", "collection"], ["in", "تحصيل من عميل", "collection"],
    ["in", "Transfer from bank", "transfer"], ["in", "Interest received", "other_income"],
    ["out", "Rent", "expense"], ["out", "Electricity", "expense"], ["out", "Stock purchase", "purchase"], ["out", "مشتريات بضاعة", "purchase"],
    ["out", "Owner drawings", "drawings"], ["out", "مسحوبات شخصية", "drawings"], ["out", "New fridge (equipment)", "asset"], ["out", "شراء جهاز", "asset"],
    ["out", "Loan repayment", "loan_repayment"], ["out", "قسط القرض", "loan_repayment"], ["out", "Deposit to bank", "transfer"],
  ])("%s · %s → %s", (dir, text, kind) => {
    expect(detectKind(dir as "in" | "out", text)).toBe(kind);
  });
  it("only sales, collections and other income in, expenses and purchases out, are trading", () => {
    expect(["sale", "collection", "other_income", "expense", "purchase"].every(isTradingKind)).toBe(true);
    expect(["capital", "loan", "transfer", "drawings", "asset", "loan_repayment"].some(isTradingKind)).toBe(false);
  });
});

const e = (day: string, direction: "in" | "out", amount: number, category: string, extra: Partial<Entry> = {}): Entry =>
  ({ day, direction, amount, category, party: "", paid: null, paidOn: null, ...extra });

describe("figures by kind (panel H08)", () => {
  // A kiosk: 3,000 of sales in March, owner puts in 20,000, a 10,000 loan; 1,000 rent, 15,000 on a fridge, 2,000 drawn.
  const entries: Entry[] = [
    e("2026-03-02", "in", 1000, "Sales", { kind: "sale" }), e("2026-03-09", "in", 2000, "Sales", { kind: "sale" }),
    e("2026-03-01", "in", 20000, "Owner capital", { kind: "capital", party: "Owner" }), e("2026-03-05", "in", 10000, "Loan", { kind: "loan", party: "Banque Misr" }),
    e("2026-03-03", "out", 1000, "Rent", { kind: "expense" }), e("2026-03-04", "out", 15000, "Fridge", { kind: "asset" }), e("2026-03-20", "out", 2000, "Drawings", { kind: "drawings" }),
    e("2026-03-25", "in", 500, "Sales", { kind: "sale", party: "Hala", paid: false }),
  ];
  const f = cashFigures(entries, { opening: { amount: 0, asOf: "2026-02-28" }, today: "2026-04-10", range: "month" });

  it("money in and out are trading only: the owner's money, loans and equipment are shown apart", () => {
    expect(f.total.in).toBe(3000);
    expect(f.total.out).toBe(1000);
    expect(f.total.net).toBe(2000);
    expect(f.other).toEqual({ in: 30000, out: 17000 });
  });
  it("sold counts the credit sale; came in does not until it is paid", () => {
    expect(f.sold).toBe(3500);
  });
  it("who pays the most ranks by what was collected, never the owner or the bank", () => {
    expect(f.parties.ok ? f.parties.value.map((p) => p.name) : []).toEqual([]);
  });
  it("cash counts everything that moved, whatever its kind", () => {
    expect(f.cash.ok && f.cash.value).toBe(3000 + 30000 - 1000 - 17000);
  });
});

describe("cash today on the opening-cash day (panel M21)", () => {
  it("counts entries dated on the day the opening cash was counted", () => {
    const f = cashFigures([e("2026-03-01", "in", 300, "Sales", { kind: "sale" })], { opening: { amount: 1000, asOf: "2026-03-01" }, today: "2026-03-01", range: "month" });
    expect(f.cash.ok && f.cash.value).toBe(1300);
  });
});
