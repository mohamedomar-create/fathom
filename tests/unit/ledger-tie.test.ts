import { describe, expect, it } from "vitest";
import { clearedNotice } from "@/lib/company/ledger-tie";

describe("ledger lines that stop matching the accounts", () => {
  it("are never cleared silently: the person is told which months and what to do", () => {
    expect(clearedNotice({ sales: ["2026-01", "2026-02"], expenses: [] })).toBe(
      "Sales lines for Jan 2026 and Feb 2026 no longer matched the P&L, so they were removed. Upload the General Ledger for those months again to bring them back.");
    expect(clearedNotice({ sales: [], expenses: ["2026-03"] })).toBe(
      "Expense lines for Mar 2026 no longer matched the P&L, so they were removed. Upload the General Ledger for that month again to bring them back.");
    expect(clearedNotice({ sales: [], expenses: [] })).toBeNull();
  });
});
