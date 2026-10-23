import { describe, expect, it } from "vitest";
import { expenseLineText, salesLineText } from "@/lib/company/month-print";

const sale = { day: "2026-01-05", doc: "INV/1", customer: "Nile", product: "Kit", qty: 2, amount: 100, cost: 60 };
const exp = { day: "2026-01-05", doc: "", supplier: "", account: "Rent", label: "", amount: 800 };

describe("month fingerprints with Simple-mode columns", () => {
  it("a Full-mode line hashes exactly as before (no Simple columns)", () => {
    expect(salesLineText(sale)).toBe(["2026-01-05", "INV/1", "Nile", "Kit", "10000", "20000", "6000"].join("\u001f"));
    expect(expenseLineText(exp)).toBe(["2026-01-05", "", "", "Rent", "", "80000"].join("\u001f"));
  });
  it("a sale that became paid is a changed month, so re-uploading the sheet saves it", () => {
    expect(salesLineText({ ...sale, paid: false })).not.toBe(salesLineText({ ...sale, paid: true, paidOn: "2026-01-20" }));
    expect(salesLineText({ ...sale, channel: "Shop" })).not.toBe(salesLineText(sale));
  });
  it("an expense that became paid is a changed month", () => {
    expect(expenseLineText({ ...exp, paid: false })).not.toBe(expenseLineText({ ...exp, paid: true }));
  });
});
