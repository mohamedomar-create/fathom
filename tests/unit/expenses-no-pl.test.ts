import { describe, expect, it } from "vitest";
import { accountsFromLines, expensesAnalysis, summariseExpenses } from "@/lib/engine/expenses";

// Panel H12: with no P&L, the lines were compared with themselves and the page said they "agree with the P&L".
const lines = [
  { day: "2026-03-02", period: "2026-03", doc: "BILL/1", series: "BILL", supplier: "Cairo Property", account: "Rent", cls: null, category: "Rent", label: "", amount: 30000, source: "file" as const },
  { day: "2026-03-09", period: "2026-03", doc: "BILL/2", series: "BILL", supplier: "Misr Power", account: "Electricity", cls: null, category: "Electricity", label: "", amount: 4500, source: "file" as const },
];

describe("expenses with no P&L loaded", () => {
  it("never claim to agree with a P&L: there is nothing to check them against", () => {
    const d = summariseExpenses(lines, "file");
    const s = expensesAnalysis(accountsFromLines(d), d, { type: "month", end: "2026-03" }, 1, { fromLines: true });
    expect(s.reconcilable).toBe(false);
    expect(s.unreconciled).toEqual([]);
    expect(s.trend.every((t) => t.lines === null)).toBe(true);
  });
});
