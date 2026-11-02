import { describe, expect, it } from "vitest";
import { diffSheets } from "@/lib/export/diff-list";

const rows = [
  { period: "2026-01", account: "410000 Revenues", books: 1000, file: 900, diff: 100 },
  { period: "2026-02", account: "410000 Revenues", books: 2000, file: 2050, diff: -50 },
  { period: "2026-01", account: "620100 Rent", books: 300, file: 0, diff: 300 },
  ...Array.from({ length: 2500 }, (_, i) => ({ period: "2026-03", account: `7${String(i).padStart(5, "0")} Misc`, books: 1, file: 0, diff: 1 })),
];

describe("D5: a difference list downloads in full, with a summary by account", () => {
  it("every row is in the list, none cut off", () => {
    const [all] = diffSheets(rows);
    expect(all.rows.length).toBe(1 + rows.length);
    expect(all.rows[0]).toEqual(["Month", "Account", "Books", "File", "Difference"]);
  });
  it("the summary has one row per account, its months, and totals that add up to the list", () => {
    const [, sum] = diffSheets(rows);
    expect(sum.name).toBe("Summary by account");
    expect(sum.rows[0]).toEqual(["Account", "Months", "Books", "File", "Difference"]);
    const rev = sum.rows.find((r) => r[0] === "410000 Revenues")!;
    expect(rev).toEqual(["410000 Revenues", 2, 3000, 2950, 50]);
    // Largest difference first.
    expect(sum.rows[1][0]).toBe("620100 Rent");
    const total = (i: number) => sum.rows.slice(1).reduce((s, r) => s + Number(r[i]), 0);
    expect(total(4)).toBeCloseTo(rows.reduce((s, r) => s + r.diff, 0), 6);
    expect(sum.rows.length).toBe(1 + 2 + 2500);
  });
  it("labels can be given in Arabic", () => {
    const [all, sum] = diffSheets(rows.slice(0, 1), { month: "الشهر", account: "الحساب", books: "الدفاتر", file: "الملف", difference: "الفرق", months: "الأشهر", list: "الفروق", summary: "ملخص حسب الحساب" });
    expect(all.name).toBe("الفروق");
    expect(sum.rows[0][0]).toBe("الحساب");
  });
});
