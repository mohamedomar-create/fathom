import { describe, expect, it } from "vitest";
import { bsCalc, computeKpis, closingKpis, plCalc, KPI_DEFS, KPI_BY_KEY } from "@/lib/engine";

// One year, hand-worked: revenue 1,200, cost of sales 600, expenses 300, other income 0 → EBIT 300; interest 50 paid, 20 earned.
const P = plCalc({ revenue: 1200, cos_variable: 600, exp_fixed: 300, interest_expenses: 50, interest_income: 20 });
// Opening and closing: total assets 2,000 → 3,000; current liabilities 500 → 1,000; equity 1,000 → 1,500; borrowing 500 → 500.
const B0 = bsCalc({ cash: 1000, ar: 500, inventory: 500, ap: 500, ltd: 500, retained_earnings: 1000 });
const B = bsCalc({ cash: 1500, ar: 1000, inventory: 500, ap: 1000, ltd: 500, retained_earnings: 1500 });
// The average carries 250 of short-term borrowing, so capital employed (1,750) differs from equity + borrowing (2,000).
const Bavg = bsCalc({ cash: 1500, ar: 750, inventory: 500, ap: 750, std: 250, ltd: 500, retained_earnings: 1250 });
const inp = { P, B, B0, Bavg, Pprev: null, days: 365, ocf: null };

describe("capital employed is total assets less current liabilities", () => {
  it("the balance sheet carries it", () => {
    expect(B.capital_employed).toBe(3000 - 1000);
    expect(B0.capital_employed).toBe(2000 - 500);
  });
  it("ROCE is a year's EBIT over the average capital employed", () => {
    // Average capital employed = average assets 2,750 − average current liabilities 1,000 = 1,750 (not equity + borrowing 2,000).
    expect(computeKpis(inp).roce).toBeCloseTo((300 / 1750) * 100, 6);
  });
  it("the activity ratio is a year's revenue over the average capital employed", () => {
    expect(computeKpis(inp).activity).toBeCloseTo(1200 / 1750, 6);
  });
  it("not measured when capital employed is zero or negative", () => {
    const Bn = bsCalc({ cash: 100, ap: 300, retained_earnings: -200 });
    expect(computeKpis({ P, B: Bn, B0: null, Pprev: null, days: 365, ocf: null }).roce).toBeNull();
  });
});

describe("net interest cover beside the gross figure", () => {
  it("gross stays EBIT ÷ interest paid; net is EBIT ÷ (interest paid − interest earned)", () => {
    const k = computeKpis(inp);
    expect(k.int_cover).toBeCloseTo(300 / 50, 6);
    expect(k.net_int_cover).toBeCloseTo(300 / 30, 6);
  });
  it("not measured when the business earns more interest than it pays", () => {
    const k = computeKpis({ ...inp, P: plCalc({ revenue: 1200, interest_expenses: 10, interest_income: 20 }) });
    expect(k.net_int_cover).toBeNull();
  });
});

describe("expense ratios with one meaning each", () => {
  it("operating expense ratio is operating expenses over revenue", () => {
    expect(computeKpis(inp).exp_ratio).toBeCloseTo((300 / 1200) * 100, 6);
    expect(KPI_BY_KEY.exp_ratio.name).toBe("Operating Expense Ratio");
  });
  it("total cost to revenue adds cost of sales (Fathom's Expense-to-Revenue)", () => {
    expect(computeKpis(inp).cost_ratio).toBeCloseTo(((600 + 300) / 1200) * 100, 6);
  });
});

describe("margin of safety in money too", () => {
  it("not measured on negative revenue", () => {
    const k = computeKpis({ ...inp, P: plCalc({ revenue: -100, cos_variable: 50, exp_fixed: 10 }) });
    expect(k.mos).toBeNull();
    expect(k.mos_amount).toBeNull();
  });
  it("revenue less breakeven revenue", () => {
    // Variable cost ratio 0.5; fixed costs 300 → breakeven revenue 600; safety 600 EGP = 50%.
    const k = computeKpis(inp);
    expect(k.mos_amount).toBeCloseTo(600, 6);
    expect(k.mos).toBeCloseTo(50, 6);
  });
});

describe("closing-balance figures beside the averages (as Fathom shows them)", () => {
  it("days and returns on the closing balance sheet", () => {
    const c = closingKpis(inp);
    // Closing AR 1,000 net of 14% VAT over a year's revenue 1,200.
    expect(c.ar_days).toBeCloseTo((1000 / 1.14 / 1200) * 365, 6);
    expect(c.roce).toBeCloseTo((300 / 2000) * 100, 6);
    expect(c.roe).toBeCloseTo((P.net_income / 1500) * 100, 6);
  });
  it("Fathom's ROE on opening equity", () => {
    expect(closingKpis(inp).roe_opening).toBeCloseTo((P.net_income / 1000) * 100, 6);
  });
});

describe("formula text says what the code divides by", () => {
  it("every growth KPI divides by the absolute prior value", () => {
    for (const key of ["rev_growth", "gp_growth", "ebit_growth", "asset_change", "equity_change"]) {
      expect(KPI_BY_KEY[key].formula, key).toMatch(/÷ \|/);
    }
  });
  it("ROCE and activity name capital employed", () => {
    expect(KPI_BY_KEY.roce.formula).toMatch(/Capital Employed \(Total Assets − Current Liabilities\)/);
    expect(KPI_BY_KEY.activity.formula).toMatch(/Capital Employed/);
  });
  it("every KPI the engine computes has a definition, and every definition is computed", () => {
    const k = computeKpis(inp);
    for (const d of KPI_DEFS) expect(d.key in k, d.key).toBe(true);
    for (const key of Object.keys(k)) expect(KPI_BY_KEY[key], key).toBeDefined();
  });
});

describe("Real profit: what customers owe moves cash collected the right way", async () => {
  const { receivablesLine } = await import("@/lib/engine/real-profit");
  it("an increase in receivables reduces cash collected, shown as 'less'", () => {
    expect(receivablesLine(150)).toEqual({ dir: "less", value: -150 });
  });
  it("a decrease in receivables adds to cash collected, shown as 'add'", () => {
    expect(receivablesLine(-80)).toEqual({ dir: "add", value: 80 });
  });
  it("no movement reads 0, not −0", () => {
    expect(Object.is(receivablesLine(0)!.value, -0)).toBe(false);
  });
  it("no figure without an opening balance sheet", () => {
    expect(receivablesLine(null)).toBeNull();
  });
});
