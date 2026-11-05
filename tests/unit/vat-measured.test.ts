import { describe, expect, it } from "vitest";
import { measureVat } from "@/lib/ingest/vat-rate";
import { vatRateOf } from "@/lib/company/time-zone";

const e = (period: string, amount: number) => ({ day: `${period}-15`, period, ref: "INV", label: "", partner: "", amount });
const rev = (entries: ReturnType<typeof e>[]) => ({ code: "410000", name: "Revenues", cls: "revenue", excluded: false, entries });
const vat = (entries: ReturnType<typeof e>[], name = "Output VAT 14%") => ({ code: "214100", name, cls: "tax_liab", excluded: false, entries });

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
  it("uses the last 12 months of the file", () => {
    const m = measureVat([rev([e("2024-12", -1000), e("2026-01", -1000)]), vat([e("2026-01", -140)])]);
    expect(m!.from).toBe("2025-02");
    expect(m!.to).toBe("2026-01");
    expect(m!.rate).toBeCloseTo(0.14, 9);
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
  it("the rate the person set wins", () => {
    expect(vatRateOf({ profile: { vatRate: 0.05, vatMeasured: { rate: 0, from: "2025-01", to: "2025-12" } } })).toBe(0.05);
  });
  it("otherwise the measured rate", () => {
    expect(vatRateOf({ profile: { vatMeasured: { rate: 0.031, from: "2025-01", to: "2025-12" } } })).toBe(0.031);
  });
  it("otherwise none (the engine's 14%)", () => {
    expect(vatRateOf({ profile: {} })).toBeUndefined();
  });
});
