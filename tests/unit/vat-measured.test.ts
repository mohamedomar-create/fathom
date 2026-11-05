import { describe, expect, it } from "vitest";
import { measureVat } from "@/lib/ingest/vat-rate";
import { vatRateOf, vatSalesRateOf } from "@/lib/company/time-zone";
import { bsCalc, computeKpis, plCalc } from "@/lib/engine";
import { classify } from "@/lib/ingest/classify";

const e = (period: string, amount: number) => ({ day: `${period}-15`, period, ref: "INV", label: "", partner: "", amount });
const rev = (entries: ReturnType<typeof e>[]) => ({ code: "410000", name: "Revenues", cls: "revenue", excluded: false, entries });
// The class the classifier really gives an Odoo current liability named "Output VAT 14%".
const outCls = classify("Output VAT 14%", "liability_current", "BS").cls;
const vat = (entries: ReturnType<typeof e>[], name = "Output VAT 14%", cls: string | null = outCls) => ({ code: "214100", name, cls, excluded: false, entries });
const ep = (period: string, amount: number, partner: string, ref = "INV") => ({ day: `${period}-15`, period, ref, label: "", partner, amount });

describe("the VAT rate measured from the General Ledger", () => {
  it("a seller charging 14% on everything measures 14%", () => {
    const m = measureVat([rev([e("2026-01", -1000), e("2026-02", -1000)]), vat([e("2026-01", -140), e("2026-02", -140)])]);
    expect(m!.rate).toBeCloseTo(0.14, 9);
  });
  it("a VAT-exempt seller (output VAT account, nothing charged) measures 0%", () => {
    expect(measureVat([rev([e("2026-01", -1000)]), vat([e("2026-01", 500)])])!.rate).toBe(0);
  });
  it("a mixed seller: 14% on 40% of sales measures 5.6%", () => {
    expect(measureVat([rev([e("2026-01", -1000)]), vat([e("2026-01", -56)])])!.rate).toBeCloseTo(0.056, 9);
  });
  it("only output VAT counts: payments to the Tax Authority (debits) and input VAT are left out", () => {
    const m = measureVat([rev([e("2026-01", -1000)]), vat([e("2026-01", -140), e("2026-01", 140)]), vat([e("2026-01", 80)], "Input VAT")]);
    expect(m!.rate).toBeCloseTo(0.14, 9);
  });
  it("uses the last 12 months of revenue, and names the months it really used", () => {
    const m = measureVat([rev([e("2024-12", -1000), e("2025-11", -1000), e("2026-01", -1000)]), vat([e("2025-11", -140), e("2026-01", -140), e("2026-02", -999)])]);
    expect(m!.to).toBe("2026-01");
    expect(m!.from).toBe("2025-11");
    expect(m!.rate).toBeCloseTo(0.14, 9);
  });
  it("finds 'Output VAT' under the class the classifier gives it", () => {
    expect(outCls).not.toBe("tax_liab");
    expect(measureVat([rev([e("2026-01", -1000)]), vat([e("2026-01", -140)])])!.rate).toBeCloseTo(0.14, 9);
  });
  it("credit notes (debits with a customer) reduce output VAT, as returns reduce revenue", () => {
    // Taxable sales 500 (VAT 70), returns 200 of them (VAT 28): net revenue 800, net VAT 42 → 5.25%.
    const m = measureVat([rev([e("2026-01", -1000), e("2026-01", 200)]), vat([ep("2026-01", -70, "Cust A"), ep("2026-01", 28, "Cust A", "RINV/2026/0001"), ep("2026-01", 42, "")])]);
    expect(m!.rate).toBeCloseTo(42 / 800, 9);
  });
  it("a settlement to the Tax Authority is not a credit note", () => {
    const m = measureVat([rev([e("2026-01", -1000)]), vat([ep("2026-01", -140, "Cust A"), ep("2026-01", 140, "مصلحة الضرائب")])]);
    expect(m!.rate).toBeCloseTo(0.14, 9);
  });
  it("a net 'VAT Payable' account is ignored when a dedicated output VAT account exists", () => {
    const m = measureVat([rev([e("2026-01", -1000)]), vat([e("2026-01", -56)]), vat([e("2026-01", -40)], "VAT Payable", "tax_liab")]);
    expect(m!.rate).toBeCloseTo(0.056, 9);
  });
  it("never above 14%", () => {
    expect(measureVat([rev([e("2026-01", -1000)]), vat([e("2026-01", -300)])])!.rate).toBe(0.14);
  });
  it("nothing measured without an output VAT account, or without revenue", () => {
    expect(measureVat([rev([e("2026-01", -1000)])])).toBeNull();
    expect(measureVat([vat([e("2026-01", -140)])])).toBeNull();
  });
  it("Arabic account names are found", () => {
    expect(measureVat([rev([e("2026-01", -1000)]), vat([e("2026-01", -140)], "ضريبة القيمة المضافة - مبيعات")])!.rate).toBeCloseTo(0.14, 9);
  });
});

describe("which VAT rate the company uses", () => {
  const measured = { rate: 0.031, from: "2025-01", to: "2025-12" };
  it("the rate the person set wins on both sides", () => {
    expect(vatRateOf({ profile: { vatRate: 0.05, vatMeasured: measured } })).toBe(0.05);
    expect(vatSalesRateOf({ profile: { vatRate: 0.05, vatMeasured: measured } })).toBe(0.05);
  });
  it("the measured (sales) rate is for customers only: supplier days keep 14%", () => {
    expect(vatSalesRateOf({ profile: { vatMeasured: measured } })).toBe(0.031);
    expect(vatRateOf({ profile: { vatMeasured: measured } })).toBeUndefined();
  });
  it("otherwise none (the engine's 14%)", () => {
    expect(vatSalesRateOf({ profile: {} })).toBeUndefined();
  });
  it("customer days use the sales rate, supplier days the purchase rate", () => {
    const P = plCalc({ revenue: 1000, cos_variable: 400 });
    const B = bsCalc({ cash: 100, ar: 1000, ap: 456, retained_earnings: 644 });
    const k = computeKpis({ P, B, B0: null, Pprev: null, days: 365, ocf: null, vat: 0.14, vatSales: 0 });
    expect(k.ar_days).toBeCloseTo(365, 6);
    expect(k.ap_days).toBeCloseTo(365, 6);
  });
});
