import { describe, expect, it } from "vitest";
import { buildMonths } from "@/lib/company/build";
import type { AccountLine } from "@/lib/company/types";
import { bsCalc, cashFlowStatement, cashWaterfall, cfSubOf, plCalc } from "@/lib/engine";

// A hand-worked month (natural signs). Opening: cash 1,000; receivables 500; fixed assets 3,000 of which right-of-use 400;
// other current liabilities 600 (interest payable 100, dividends payable 50, accruals 450); taxes owed 300 (income tax
// 200, VAT 100); other non-current 900 (end of service 300, deferred tax 100, lease 500); loan 1,000; equity 1,700.
// The month: revenue 2,000; costs 800; depreciation 150 (40 on right-of-use); gain on a disposal 60 (proceeds 200, book
// value 140); interest 30; income tax 120; dividends 70; capex 300; a new lease adds 110 to right-of-use.
// Cash: operating 1,070; investing −100 (−300 + 200); financing −130 (interest −20, dividends −60, lease −50).
const a = (name: string, cls: string, o: number, c: number, sub?: string): AccountLine =>
  ({ id: name, code: "", name, cls: cls as never, amounts: { "2026-08": o, "2026-09": c }, ...(sub ? { sub: sub as never } : {}) });
const pl = (name: string, cls: string, v: number, sub?: string): AccountLine =>
  ({ id: name, code: "", name, cls: cls as never, amounts: { "2026-09": v }, ...(sub ? { sub: sub as never } : {}) });
const accounts = (subs: boolean): AccountLine[] => {
  const s = (k: string) => (subs ? k : undefined);
  return [
    a("Cash", "cash", 1000, 1840), a("Receivables", "ar", 500, 600),
    a("Equipment", "fixed_assets", 2600, 2650), a("Right-of-use", "fixed_assets", 400, 470, s("rou_asset")),
    a("Interest payable", "other_cl", 100, 110, s("interest_payable")), a("Dividends payable", "other_cl", 50, 60, s("dividends_payable")), a("Accruals", "other_cl", 450, 470),
    a("Income tax payable", "tax_liab", 200, 250, s("income_tax_payable")), a("VAT payable", "tax_liab", 100, 80),
    a("End of service", "other_ncl", 300, 330, s("end_of_service")), a("Deferred tax", "other_ncl", 100, 110, s("deferred_tax")), a("Lease liability", "other_ncl", 500, 560, s("lease_liability")),
    a("Loan", "ltd", 1000, 1000), a("Retained earnings", "retained_earnings", 1700, 2590),
    pl("Sales", "revenue", 2000), pl("Rent", "exp_fixed", 800), pl("Depreciation", "exp_depreciation", 110), pl("Depreciation ROU", "exp_depreciation", 40, s("rou_depreciation")),
    pl("Gain on sale", "other_income", 60, s("disposal_gain")), pl("Interest", "interest_expenses", 30), pl("Income tax", "tax_expenses", 120), pl("Dividends", "dividends", 70),
  ];
};
const statement = (subs: boolean) => {
  const [m0, m1] = buildMonths(accounts(subs));
  return cashFlowStatement(plCalc(m1.pl), bsCalc(m1.bs), bsCalc(m0.bs), { sub: cfSubOf([m1], m1, m0) });
};
const line = (s: ReturnType<typeof statement>, rx: RegExp) => s.lines.find((l) => rx.test(l.label))?.value;

describe("cash flow statement to IAS 7, with sub-classes", () => {
  const s = statement(true);
  it("operating, investing and financing as worked by hand, tying to the change in cash", () => {
    expect(s.cfo).toBeCloseTo(1070, 6);
    expect(s.cfi).toBeCloseTo(-100, 6);
    expect(s.cff).toBeCloseTo(-130, 6);
    expect(s.unreconciled).toBe(0);
    expect(s.cfo + s.cfi + s.cff).toBeCloseTo(840, 6);
  });
  it("interest, dividends and income tax are what was paid, not the charge", () => {
    expect(line(s, /^Interest paid/)).toBeCloseTo(-20, 6);
    expect(line(s, /^Dividends paid/)).toBeCloseTo(-60, 6);
    expect(line(s, /^Income tax paid/)).toBeCloseTo(-70, 6);
    // VAT and payroll taxes stay in working capital.
    expect(line(s, /VAT and other taxes/)).toBeCloseTo(-20, 6);
  });
  it("the disposal gain leaves operating and its proceeds sit in investing; the lease is financing", () => {
    expect(line(s, /gain or loss on disposal/i)).toBeCloseTo(-60, 6);
    expect(line(s, /^Purchase \/ sale of fixed assets/i)).toBeCloseTo(-100, 6);
    expect(line(s, /^Lease payments/)).toBeCloseTo(-50, 6);
    expect(line(s, /provisions and end-of-service/i)).toBeCloseTo(30, 6);
    expect(line(s, /deferred tax/i)).toBeCloseTo(10, 6);
  });
  it("says nothing is estimated", () => expect(s.estimated).toEqual([]));
  it("the waterfall's operating cash flow is the statement's", () => {
    const [m0, m1] = buildMonths(accounts(true));
    const w = cashWaterfall(plCalc(m1.pl), bsCalc(m1.bs), bsCalc(m0.bs), cfSubOf([m1], m1, m0));
    expect(w.ocf).toBeCloseTo(s.cfo, 6);
    expect(w.unreconciled).toBe(0);
  });
});

describe("without sub-classes the statement still ties, and says which lines are estimated", () => {
  const s = statement(false);
  it("the same change in cash", () => {
    expect(s.cfo + s.cfi + s.cff).toBeCloseTo(840, 6);
    expect(s.unreconciled).toBe(0);
  });
  it("names the estimated lines", () => {
    expect(s.estimated.length).toBeGreaterThan(0);
    expect(s.estimated.join(" ")).toMatch(/interest/i);
  });
});

describe("unrealised exchange differences are their own line", () => {
  it("taken out of operating and shown as the effect of exchange rates on cash", () => {
    const acc = [
      a("Cash USD", "cash", 1000, 1050), a("Equity", "retained_earnings", 1000, 1050),
      pl("Revaluation gain", "other_income", 50, "fx_unrealised"),
    ];
    const [m0, m1] = buildMonths(acc);
    const s = cashFlowStatement(plCalc(m1.pl), bsCalc(m1.bs), bsCalc(m0.bs), { sub: cfSubOf([m1], m1, m0) });
    expect(s.cfo).toBeCloseTo(0, 6);
    expect(line(s, /exchange rates/)).toBeCloseTo(50, 6);
    expect(s.unreconciled).toBe(0);
  });
});

describe("two columns list the same lines", () => {
  it("a disposal or a marked account in one period gives both periods the line", async () => {
    const { alignSubs } = await import("@/lib/engine/cashflow");
    const one = { p: { disposal_gain: 60 }, b: { interest_payable: 110 }, b0: { interest_payable: 100 }, of: { other_cl: 110 }, of0: { other_cl: 100 } };
    const [x, y] = alignSubs(one, undefined);
    const P = plCalc({ revenue: 100 }), B = bsCalc({ cash: 100, retained_earnings: 100 }), B0 = bsCalc({ cash: 0, retained_earnings: 0 });
    const labels = (s: typeof x) => cashFlowStatement(P, B, B0, { sub: s }).lines.map((l) => l.label);
    expect(labels(y)).toEqual(labels(x));
    expect(labels(y)).toContain("Less gain or loss on disposal (in investing)");
  });
});
