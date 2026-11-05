import { describe, expect, it } from "vitest";
import { costOfCapital } from "@/lib/engine/valuation/wacc";
import { dcf } from "@/lib/engine/valuation/dcf";
import { multipleValue } from "@/lib/engine/valuation/multiples";
import { equityBridge } from "@/lib/engine/valuation/bridge";
import { assetValues } from "@/lib/engine/valuation/assets";
import { qualityScore } from "@/lib/engine/valuation/quality";
import { combine } from "@/lib/engine/valuation/combine";
import { normalise } from "@/lib/engine/valuation/normalise";

const near = (a: number, b: number, tol = 0.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe("cost of capital", () => {
  it("builds cost of equity and WACC the textbook way", () => {
    const w = costOfCapital({ riskFree: 0.2, beta: 1, equityPremium: 0.07, sizePremium: 0.03, specificPremium: 0.02, costOfDebt: 0.25, taxRate: 0.225, debtWeight: 0.3 });
    near(w.costOfEquity, 0.32, 1e-9);
    near(w.afterTaxDebt, 0.25 * 0.775, 1e-9);
    near(w.wacc, 0.7 * 0.32 + 0.3 * 0.25 * 0.775, 1e-9);
  });
});

describe("discounted cash flow", () => {
  const base = { revenue: 100, growth: [0.1, 0.1, 0.1, 0.1, 0.1], longGrowth: 0.05, ebitdaMargin: [0.2, 0.2, 0.2, 0.2, 0.2], daPct: 0.05, capexPct: 0.05, nwcPct: 0, taxRate: 0.2 };
  it("projects free cash flow, discounts it mid-year and adds a Gordon terminal value", () => {
    const r = dcf({ ...base, wacc: 0.15 });
    // Year 1: revenue 110, EBITDA 22, D&A 5.5, EBIT 16.5, tax 3.3, capex 5.5 -> FCF 13.2
    near(r.years[0].fcf, 13.2, 1e-9);
    near(r.years[0].discount, 1 / Math.pow(1.15, 0.5), 1e-9);
    const fcf5 = r.years[4].fcf;
    near(r.terminal, (fcf5 * 1.05) / (0.15 - 0.05), 1e-6);
    // Mid-year convention: the terminal value is discounted half a year less than the year-end, as its flows are too.
    near(r.pvTerminal, r.terminal / Math.pow(1.15, 4.5), 1e-6);
    near(r.ev, r.years.reduce((s, y) => s + y.pv, 0) + r.pvTerminal, 1e-6);
    expect(r.terminalShare).toBeGreaterThan(0.5);
    near(r.impliedExitMultiple, r.terminal / r.years[4].ebitda, 1e-9);
  });
  it("a discount rate that falls to a long-run rate: each year's rate compounds, the terminal value uses the long-run one", () => {
    const r = dcf({ ...base, wacc: 0.25, terminalWacc: 0.15 });
    const w = [0.25, 0.225, 0.2, 0.175, 0.15];
    let df = 1;
    for (let t = 0; t < 5; t++) { const mid = df / Math.sqrt(1 + w[t]); near(r.years[t].discount, mid, 1e-9); df /= 1 + w[t]; }
    near(r.terminal, (r.years[4].fcf * 1.05) / (0.15 - 0.05), 1e-6);
    near(r.pvTerminal, r.terminal * df * Math.sqrt(1.15), 1e-6);
  });
  it("working capital grows with sales and takes cash", () => {
    const a = dcf({ ...base, wacc: 0.15 });
    const b = dcf({ ...base, nwcPct: 0.2, wacc: 0.15 });
    near(a.years[0].fcf - b.years[0].fcf, 0.2 * 10, 1e-9);
  });
  it("refuses a growth rate at or above the long-run discount rate", () => {
    expect(() => dcf({ ...base, wacc: 0.05 })).toThrow();
    expect(() => dcf({ ...base, wacc: 0.3, terminalWacc: 0.05 })).toThrow();
  });
});

describe("multiples", () => {
  it("applies the low, median and high multiple and the private-company discount", () => {
    const v = multipleValue(10, { low: 5, mid: 7, high: 9 }, 0.25);
    expect(v).toEqual({ low: 37.5, mid: 52.5, high: 67.5 });
  });
  it("is not applicable on a loss", () => {
    expect(multipleValue(-3, { low: 5, mid: 7, high: 9 }, 0.25)).toBeNull();
  });
});

describe("from enterprise value to equity", () => {
  it("takes off debt and debt-like items and adds cash and investments", () => {
    const b = equityBridge(1000, { cash: 80, investments: 20, debt: 300, lease: 50, endOfService: 30, provisions: 10, dividendsPayable: 5 });
    expect(b.equity).toBe(1000 - 300 - 50 - 30 - 10 - 5 + 80 + 20);
    expect(b.rows.map((r) => r.key)).toEqual(["ev", "debt", "lease", "endOfService", "provisions", "dividendsPayable", "cash", "investments", "equity"]);
  });
});

describe("net assets", () => {
  it("book, adjusted (slow stock and old receivables) and liquidation", () => {
    const a = assetValues({ equity: 500, cash: 100, ar: 200, arOver180: 40, inventory: 150, slowStock: 30, fixedAssets: 300, intangibles: 50, investments: 20, otherCA: 30, liabilities: 350, endOfService: 0, lease: 0 });
    expect(a.book).toBe(500);
    // Adjusted: less old receivables (40), slow stock (30) and intangibles (50), less end of service not in books (0 extra).
    expect(a.adjusted).toBe(500 - 40 - 30 - 50);
    // Liquidation: cash 100, receivables (200-40)*0.7, stock (150-30)*0.5, fixed 300*0.4, investments 20*0.8, other 30*0.3, less liabilities 350.
    near(a.liquidation, 100 + 160 * 0.7 + 120 * 0.5 + 120 + 16 + 9 - 350, 1e-9);
  });
});

describe("quality of earnings", () => {
  it("full marks for long, clean, spread-out books", () => {
    expect(qualityScore({ months: 36, hasBalanceSheet: true, openChecks: 0, topCustomerShare: 0.1, revenueVolatility: 0.1, dso: 45 }).score).toBe(100);
  });
  it("short history, open checks and one big customer cost points, each named", () => {
    const q = qualityScore({ months: 12, hasBalanceSheet: true, openChecks: 2, topCustomerShare: 0.5, revenueVolatility: 0.1, dso: 45 });
    expect(q.score).toBe(100 - 18 - 10 - 18);
    expect(q.deductions.map((d) => d.key)).toEqual(["history", "checks", "concentration"]);
  });
});

describe("combining the methods", () => {
  it("weights the methods that apply and renormalises", () => {
    const c = combine([
      { key: "dcf", value: { low: 80, mid: 100, high: 120 } },
      { key: "ebitda", value: { low: 60, mid: 80, high: 100 } },
      { key: "sales", value: null, reason: "x" },
    ], { dcf: 0.5, ebitda: 0.3, sales: 0.2 });
    near(c.mid, (100 * 0.5 + 80 * 0.3) / 0.8, 1e-9);
    near(c.low, (80 * 0.5 + 60 * 0.3) / 0.8, 1e-9);
    expect(c.weights.sales).toBe(0);
  });
});

describe("normalising earnings", () => {
  it("adds back one-offs and sets the owner's pay to market", () => {
    const n = normalise({ ebitda: 100, netIncome: 50, taxRate: 0.2 }, [
      { key: "oneoff", label: "lawsuit", amount: 20 },
      { key: "owner", label: "owner pay", amount: -10 },
    ]);
    expect(n.ebitda).toBe(110);
    near(n.netIncome, 50 + 10 * 0.8, 1e-9);
  });
});
