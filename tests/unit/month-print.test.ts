// Saving sales and expenses again: each month's lines get one fingerprint, computed the same way here and in the
// database (0021, line_months), so "Add new and changed" adds new months, replaces changed ones and skips the rest.
import { describe, expect, it } from "vitest";
import { expenseLineText, monthPrints, planSave, salesLineText } from "@/lib/company/month-print";

const sale = (o: Partial<Parameters<typeof salesLineText>[0]> = {}) => ({ day: "2026-01-05", period: "2026-01", doc: "INV/2026/0001", customer: "Nile Clinic", product: "[A1] Pump", qty: 2, amount: 1500.5, cost: 900, ...o });
const bill = (o: Partial<Parameters<typeof expenseLineText>[0]> = {}) => ({ day: "2026-01-07", period: "2026-01", doc: "BILL/2026/0003", supplier: "مورد القاهرة", account: "620000 Rent", label: "January rent", amount: 12000, ...o });

describe("month fingerprints", () => {
  it("a line's text is fixed: the database builds the same one (see supabase/tests/save_modes.sql)", async () => {
    expect(salesLineText(sale())).toBe("2026-01-05\u001fINV/2026/0001\u001fNile Clinic\u001f[A1] Pump\u001f150050\u001f20000\u001f90000");
    expect(expenseLineText(bill())).toBe("2026-01-07\u001fBILL/2026/0003\u001fمورد القاهرة\u001f620000 Rent\u001fJanuary rent\u001f1200000");
    expect(salesLineText(sale({ day: null, qty: null, cost: null }))).toBe("\u001fINV/2026/0001\u001fNile Clinic\u001f[A1] Pump\u001f150050\u001f\u001f");
    const p = await monthPrints([sale(), sale({ doc: "INV/2026/0002", amount: 10 })], salesLineText);
    expect(p["2026-01"].n).toBe(2);
    expect(p["2026-01"].print).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives exactly the fingerprints the database test expects", async () => {
    const s = await monthPrints([sale(), sale({ day: null, doc: "INV/2026/0002", customer: "عيادة النيل", product: "", qty: null, amount: -10, cost: null })], salesLineText);
    const e = await monthPrints([bill()], expenseLineText);
    expect(s["2026-01"].print).toBe("e3c2a3c5622301e6d0999656580c9326570ef65a16115ae7bfb3b48b35b0a8ce");
    expect(e["2026-01"].print).toBe("be3102a0fcadc65a133e93b34ff542bef173efb1dabe94702b8ce10434973e40");
  });

  it("the order of lines does not matter; any change in a line does", async () => {
    const a = await monthPrints([sale(), sale({ doc: "X" })], salesLineText);
    const b = await monthPrints([sale({ doc: "X" }), sale()], salesLineText);
    const c = await monthPrints([sale(), sale({ doc: "X", customer: "Other" })], salesLineText);
    expect(a["2026-01"].print).toBe(b["2026-01"].print);
    expect(c["2026-01"].print).not.toBe(a["2026-01"].print);
  });

  it("text is cut to the lengths the database keeps, so a long name never looks changed", () => {
    expect(salesLineText(sale({ customer: "x".repeat(250) }))).toBe(salesLineText(sale({ customer: "x".repeat(200) })));
  });
});

describe("the four ways to save", () => {
  const file = { "2026-01": { n: 2, print: "a" }, "2026-02": { n: 3, print: "b" }, "2026-03": { n: 1, print: "c" } };
  const stored = { "2025-12": { n: 9, print: "z" }, "2026-01": { n: 2, print: "a" }, "2026-02": { n: 3, print: "OLD" } };

  it("add new and changed: new months added, changed replaced, identical ones left alone", () => {
    expect(planSave(file, stored, "changed")).toEqual({ periods: ["2026-02", "2026-03"], added: ["2026-03"], changed: ["2026-02"], unchanged: ["2026-01"], replaceAll: false });
  });
  it("add only new months", () => {
    expect(planSave(file, stored, "new")).toMatchObject({ periods: ["2026-03"], added: ["2026-03"], changed: [], unchanged: [] });
  });
  it("replace these months", () => {
    expect(planSave(file, stored, "months")).toMatchObject({ periods: ["2026-01", "2026-02", "2026-03"], added: ["2026-03"], changed: ["2026-01", "2026-02"], replaceAll: false });
  });
  it("replace all: every month saved before goes, even ones the file does not have", () => {
    expect(planSave(file, stored, "all")).toMatchObject({ periods: ["2026-01", "2026-02", "2026-03"], replaceAll: true });
  });
  it("the same file twice with add new and changed saves nothing", () => {
    expect(planSave(file, file, "changed")).toMatchObject({ periods: [], added: [], changed: [], unchanged: ["2026-01", "2026-02", "2026-03"] });
  });
});
