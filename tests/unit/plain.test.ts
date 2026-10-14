import { describe, expect, it } from "vitest";
import { plainIssue } from "@/lib/ingest/plain";
import type { UploadIssue } from "@/lib/ingest/sorted";

const base = { id: "x", severity: "error" as const, sheet: "P&L" };
describe("problems in a few simple words", () => {
  it("says where and what to do", () => {
    expect(plainIssue({ ...base, row: 10, col: 4, fix: "cell", message: 'row 11, column E: "five thousand" is not a number' })).toBe("Row 11, column E: must be a number.");
    expect(plainIssue({ ...base, row: 6, col: 0, fix: "cell", message: "row 7, column A: no invoice date on this line" })).toBe("Row 7: needs a date.");
    expect(plainIssue({ ...base, row: 3, col: 0, fix: "cell", message: 'row 4, column A: "31/02/2026" is not a date' })).toBe("Row 4, column A: must be a date, like 15/01/2026.");
    expect(plainIssue({ ...base, row: 8, col: 2, fix: "cell", classCell: true, message: 'row 9, column C: "Misc" is not an iReport class' })).toBe("Row 9, column C: pick a type from the list.");
    expect(plainIssue({ ...base, fix: "class", key: "k", message: '"Bank charges" needs a class: pick one, or leave it out if it is a total.' })).toBe('Pick a type for "Bank charges".');
  });
  it("keeps every message short", () => {
    const long: UploadIssue = { ...base, severity: "check", fix: "settings", message: "NO BALANCE SHEET FOUND. Cash flow, working-capital, liquidity and return KPIs will be empty or wrong. Add a balance sheet export." };
    expect(plainIssue(long)).toBe("NO BALANCE SHEET FOUND.");
    expect(plainIssue({ ...long, message: "x".repeat(200) }).length).toBeLessThanOrEqual(90);
  });
});
