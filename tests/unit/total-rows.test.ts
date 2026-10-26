import { describe, expect, it } from "vitest";
import { normAr, TOTAL_LABEL } from "@/lib/ingest/parse";
import { readCashBook as readCash } from "@/lib/cash/read";
import { readCashBook as readFullCashBook } from "@/lib/ingest/cashbook";
import { readSalesGrid } from "@/lib/ingest/sales";
import { readExpenseGrid } from "@/lib/ingest/expenses";
import { planRows } from "@/lib/preflight/inspect";

// JS \b never matches after an Arabic letter, so "الإجمالي" was not a total anywhere (panel C02).
const LABELS = ["Total", "TOTAL:", "Grand total", "Totals", "Sub-total", "Subtotal", "الإجمالي", "الاجمالي", "إجمالي", "الإجمالي العام", "المجموع", "المجموع الفرعي"];
const g = (rows: unknown[][]) => ({ name: "Sheet1", rows: rows as never });

describe("total rows, in English and Arabic", () => {
  it("the shared label pattern knows every common total label, and not ordinary words", () => {
    for (const l of LABELS) expect(TOTAL_LABEL.test(normAr(l)), l).toBe(true);
    for (const l of ["Totalizer pump", "Supplies", "الإجماليات المتوقعة"]) expect(TOTAL_LABEL.test(normAr(l)), l).toBe(false);
  });

  it.each(LABELS)("the cash book leaves out a %s row", (label) => {
    const s = readCash([{ name: "Expenses", rows: [["Date", "Item", "Amount"], ["01/03/2026", "Rent", 1000], ["02/03/2026", "Power", 200], [label, "", 1200]] as never }]).sheets[0];
    expect(s.entries.reduce((a, e) => a + e.amount, 0)).toBe(1200);
    expect(s.skipped.map((k) => k.code)).toContain("total");
  });

  it.each(LABELS)("the sales reader leaves out a %s row", (label) => {
    const r = readSalesGrid(g([["Date", "Customer", "Product", "Amount"], ["2026-03-01", "Nour", "Pump", 500], ["2026-03-02", "Hala", "Mask", 300], [label, "", "", 800]]))!;
    expect(r.lines.reduce((a, l) => a + l.amount, 0)).toBe(800);
  });

  it.each(LABELS)("the expenses reader leaves out a %s row", (label) => {
    const r = readExpenseGrid(g([["Date", "Supplier", "Account", "Amount"], ["2026-03-01", "Misr Power", "Electricity", 500], ["2026-03-02", "Cairo Water", "Water", 300], [label, "", "", 800]]))!;
    expect(r.lines.reduce((a, l) => a + l.amount, 0)).toBe(800);
  });

  it.each(LABELS)("the full upload's cash book leaves out a %s row", (label) => {
    const r = readFullCashBook(g([["Date", "Item", "Cost"], ["2026-03-01", "Rent", 400], ["2026-03-02", "Power", 200], ["2026-03-03", "Water", 100], ["2026-03-04", "Phone", 50], [label, "", 750]]))!;
    expect(r.expenses.reduce((a, l) => a + l.amount, 0)).toBe(750);
  });

  it.each(LABELS)("the file check marks a %s row as a total", (label) => {
    const p = planRows(g([["Item", "Amount"], ["Rent", 1000], ["Power", 200], [label, 1200]]), 0, 1, [0]);
    expect(p.totals.length + p.oddTotals.length).toBe(1);
    expect(p.data.length).toBe(2);
  });

  it("a row equal to the sum of the rows above it, with no label, is not saved as an entry", () => {
    const s = readCash([{ name: "Expenses", rows: [["Date", "Item", "Amount"], ["01/03/2026", "Rent", 1000], ["02/03/2026", "Power", 200], ["", "", 1200]] as never }]).sheets[0];
    expect(s.entries.reduce((a, e) => a + e.amount, 0)).toBe(1200);
  });
});
