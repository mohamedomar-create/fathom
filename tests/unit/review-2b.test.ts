import { describe, expect, it } from "vitest";
import { buildMonths } from "@/lib/company/build";
import type { AccountLine } from "@/lib/company/types";
import { bsCalc, cashFlowStatement, cashWaterfall, cfSubOf, plCalc } from "@/lib/engine";
import { detectKind } from "@/lib/cash/kinds";
import { inferSubClass, withSubClasses } from "@/lib/ingest/subclass";
import { readBankStatement } from "@/lib/ingest/bank";

const a = (name: string, cls: string, o: number, c: number, sub?: string): AccountLine =>
  ({ id: name, code: "", name, cls: cls as never, amounts: { "2026-08": o, "2026-09": c }, ...(sub ? { sub: sub as never } : {}) });
const pl = (name: string, cls: string, v: number, sub?: string): AccountLine =>
  ({ id: name, code: "", name, cls: cls as never, amounts: { "2026-09": v }, ...(sub ? { sub: sub as never } : {}) });
const views = (acc: AccountLine[]) => {
  const [m0, m1] = buildMonths(acc);
  const sub = cfSubOf([m1], m1, m0);
  const P = plCalc(m1.pl), B = bsCalc(m1.bs), B0 = bsCalc(m0.bs);
  return { s: cashFlowStatement(P, B, B0, { sub }), w: cashWaterfall(P, B, B0, sub) };
};

describe("review 2b", () => {
  it("right-of-use depreciation marked without a lease or a right-of-use asset still ties", () => {
    const { s, w } = views([a("Cash", "cash", 100, 150), a("Leased premises", "fixed_assets", 500, 450), a("Equity", "retained_earnings", 600, 600),
      pl("Sales", "revenue", 50), pl("Depreciation - right of use", "exp_depreciation", 50, "rou_depreciation")]);
    expect(s.unreconciled).toBe(0);
    expect(w.unreconciled).toBe(0);
    expect(s.cfo + s.cfi + s.cff).toBeCloseTo(50, 6);
  });
  it("cash flow before borrowing explains itself: the lease under long-term debt is not borrowing", () => {
    const { w } = views([a("Cash", "cash", 1000, 800), a("Lease liability", "ltd", 1000, 800, "lease_liability"), a("Equity", "retained_earnings", 0, 0)]);
    expect(w.ncf).toBeCloseTo(w.dcash - w.ddebt, 6);
  });
  it("cash kinds: hire, cleaning, a client called the owner, an ATM deposit and a supplier paid by transfer are trading", () => {
    expect(detectKind("out", "Equipment rental")).toBe("expense");
    expect(detectKind("out", "ايجار معدات")).toBe("expense");
    expect(detectKind("out", "Office furniture cleaning")).toBe("expense");
    expect(detectKind("out", "Asset management fee")).toBe("expense");
    expect(detectKind("in", "Payment from owner of Villa 5")).toBe("sale");
    expect(detectKind("in", "دفعة من المالك - فيلا 5")).toBe("sale");
    expect(detectKind("in", "Bank Loan Dept - Banque Misr payment for invoice 55")).toBe("sale");
    expect(detectKind("in", "ATM deposit")).toBe("sale");
    expect(detectKind("out", "Transfer to bank Misr - El Nasr Supplies")).toBe("expense");
    // …while the clear cases still read as before.
    expect(detectKind("in", "Owner capital injection")).toBe("capital");
    expect(detectKind("in", "Loan received from Banque Misr")).toBe("loan");
    expect(detectKind("out", "Deposit to bank")).toBe("transfer");
    expect(detectKind("out", "New fridge")).toBe("asset");
  });
  it("a bank statement says which lines it left out of sales or costs", () => {
    const g = { name: "Bank", rows: [["Date", "Description", "Debit", "Credit", "Balance"], [null, "Opening balance", null, null, 1000],
      ["2026-03-02", "Card sales settlement", null, 500, 1500], ["2026-03-03", "Loan received", null, 10000, 11500]] } as never;
    const r = readBankStatement(g, { inAsSales: true })!;
    expect(r.layout.checks.map((c) => c.message).join(" ")).toMatch(/not counted as sales or costs/);
  });
  it("a loss on selling scrap is not a disposal of fixed assets", () => {
    expect(inferSubClass("Loss on sale of scrap", "other_expenses")).toBeNull();
    expect(inferSubClass("Gain on sale of fixed assets", "other_income")).toBe("disposal_gain");
  });
  it("a choice kept by the cleaned name is found for an account with a code too", () => {
    const [x] = withSubClasses([{ id: "1", code: "9", name: "  Sundry Dues ", cls: "other_cl", amounts: {} }] as never, { "sundry dues": "provisions" });
    expect(x.sub).toBe("provisions");
  });
  it("part-month comparison: the prior month's sub-classed P&L amounts are cut like its P&L", async () => {
    const { periodView } = await import("@/lib/engine");
    const m = (period: string, gain: number) => ({ period, pl: { revenue: 3000, other_income: gain }, bs: { cash: 1000, retained_earnings: 1000 }, sub: { disposal_gain: gain }, subOf: { other_income: gain } }) as never;
    const v = periodView([m("2026-08", 0), m("2026-09", 300), m("2026-10", 0)], { type: "month", end: "2026-10" }, 1, "2026-10-10");
    expect(v.prior!.sub!.p.disposal_gain).toBeCloseTo(100, 6); // 300 × 10/30
  });
});

describe("cash tied up in slow collection is measured in what customers owe (VAT included)", () => {
  it("the insight's tied cash grosses the days' revenue up by VAT", async () => {
    const { insights, plCalc: pc, bsCalc: bc } = await import("@/lib/engine");
    const P = pc({ revenue: 36500 });
    const f = insights({ P, B: bc({ cash: 1 }), Pprev: null, K: { ar_days: 100 }, W: null, tg: { ar_days: 45 }, Ps: [P], Bs: [], days: 365, status: {}, cur: "EGP", vat: 0.14 } as never);
    // 55 days too many × 100 a day = 5,500 net of VAT; customers owe 6,270.
    expect(f.find((x) => x.title.startsWith("Customers take"))!.text).toMatch(/6,270/);
  });
});
