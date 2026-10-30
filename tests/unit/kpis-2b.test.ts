import { describe, expect, it } from "vitest";
import { bsCalc, computeKpis, plCalc, analyze, KPI_DEFS, type MonthData, type CompanySettings } from "@/lib/engine";

const P = plCalc({ revenue: 1000, cos_variable: 400 });
const B0 = bsCalc({ cash: 1000, ar: 0, retained_earnings: 1000 });
const B = bsCalc({ cash: 1000, ar: 1140, ap: 456, retained_earnings: 1684 });

describe("return on equity on average equity", () => {
  it("annual net income over the average of opening and closing equity", () => {
    const k = computeKpis({ P, B, B0, Pprev: null, days: 365, ocf: null });
    // Net income 600 over a year; equity 1,000 → 1,684, average 1,342.
    expect(k.roe).toBeCloseTo((600 / 1342) * 100, 6);
  });
  it("not measured when the average equity is zero or below", () => {
    const k = computeKpis({ P, B: bsCalc({ cash: 100, std: 300, retained_earnings: -200 }), B0: bsCalc({ cash: 100, std: 200, retained_earnings: -100 }), Pprev: null, days: 365, ocf: null });
    expect(k.roe).toBeNull();
  });
});

describe("debtor and creditor days without VAT", () => {
  it("receivables and payables are taken net of VAT at the company's rate (default 14%)", () => {
    const k = computeKpis({ P, B, B0: null, Pprev: null, days: 365, ocf: null });
    // AR 1,140 incl. 14% VAT = 1,000 net; a year's revenue 1,000 → 365 days. AP 456 → 400 net over cost 400 → 365 days.
    expect(k.ar_days).toBeCloseTo(365, 6);
    expect(k.ap_days).toBeCloseTo(365, 6);
  });
  it("a company that charges no VAT sets the rate to 0", () => {
    const k = computeKpis({ P, B, B0: null, Pprev: null, days: 365, ocf: null, vat: 0 });
    expect(k.ar_days).toBeCloseTo(416.1, 6);
  });
  it("the company's rate reaches the analysis", () => {
    const m = (period: string): MonthData => ({ period, pl: { revenue: 1000, cos_variable: 400 }, bs: { cash: 1000, ar: 1140, ap: 456, retained_earnings: 1684 } } as MonthData);
    const s = (vatRate?: number) => ({ currency: "EGP", fyStartMonth: 1, taxRate: 0.225, ...(vatRate === undefined ? {} : { vatRate }) }) as CompanySettings;
    const a14 = analyze([m("2026-09")], { type: "month", end: "2026-09" }, s()).K.ar_days!;
    const a0 = analyze([m("2026-09")], { type: "month", end: "2026-09" }, s(0)).K.ar_days!;
    expect(a0 / a14).toBeCloseTo(1.14, 6);
  });
  it("the definitions say so", () => {
    expect(KPI_DEFS.find((d) => d.key === "ar_days")!.formula).toMatch(/VAT/);
    expect(KPI_DEFS.find((d) => d.key === "roe")!.formula).toMatch(/Average/);
  });
});

describe("the company's VAT rate is a profile setting", () => {
  it("read from the profile, unset when not chosen", async () => {
    const { withProfile, vatRateOf } = await import("@/lib/company/time-zone");
    expect(vatRateOf(withProfile({}, { vatRate: 0 }))).toBe(0);
    expect(vatRateOf(withProfile({}, { vatRate: 0.05 }))).toBe(0.05);
    expect(vatRateOf({})).toBeUndefined();
    expect(vatRateOf(withProfile({}, { vatRate: 14 }))).toBeUndefined(); // a percentage typed as a whole number is not a rate
  });
  it("the monthly table uses it too", async () => {
    const { monthCalcs } = await import("@/components/analysis/metrics");
    const m = (period: string): MonthData => ({ period, pl: { revenue: 1000, cos_variable: 400 }, bs: { cash: 1000, ar: 1140, retained_earnings: 1140 + 1000 } } as MonthData);
    const at = (vat?: number) => monthCalcs([m("2026-08"), m("2026-09")], null, vat).at(-1)!.K.ar_days!;
    expect(at(0) / at()).toBeCloseTo(1.14, 6);
  });
});
