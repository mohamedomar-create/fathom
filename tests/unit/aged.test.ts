// Odoo's Aged Receivable / Aged Payable report, read the way an accountant reads it: one block per partner (a header row
// with the partner's totals, its open documents, "Total <partner>"), the report's own totals at the top and bottom, and
// every figure checked against the rows it should add up to.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAged } from "@/lib/ingest/aged";
import { readWorkbook } from "@/lib/ingest/read";
import type { Grid } from "@/lib/ingest/extract";

const H = [null, "Invoice Date", "At Date", "1-30", "31-60", "61-90", "91-120", "Older", "Total"];
const _ = null;
/** An Odoo 18 Aged Receivable as exported: the as-of line, the headings, the grand total, then partner blocks. */
function receivable(): Grid {
  return {
    name: "Aged Receivable", rows: [
      [_, "As of 09/30/2026", "As of 09/30/2026"],
      [],
      H,
      ["Aged Receivable", _, 1000, 200, _, _, _, 290, 1490],
      ["Northside Hospital", _, 1000, 200, _, _, _, _, 1200],
      ["INV/2026/00101 (September invoice)", "09/12/2026", 1000, _, _, _, _, _, _],
      ["INV/2026/00088", "08/20/2026", _, 200, _, _, _, _, _],
      ["Total Northside Hospital", _, 1000, 200, _, _, _, _, 1200],
      ["مستشفى الشيخ زايد", _, _, _, _, _, _, _, _],
      ["MISC/2023/0312 (SETTLEMENT)", _, _, _, _, _, _, -40000, _],
      ["Opening Journal Entry (Opening Balance)", _, _, _, _, _, _, 40000, _],
      ["Total مستشفى الشيخ زايد", _, _, _, _, _, _, _, _],
      ["Unknown", _, _, _, _, _, _, 290, 290],
      ["CIB/2026/0377 Inward ACH", _, _, _, _, _, _, 290, _],
      ["Total Unknown", _, _, _, _, _, _, 290, 290],
      ["Total Aged Receivable", _, 1000, 200, _, _, _, 290, 1490],
    ],
  };
}
const setRow = (g: Grid, label: string, col: number, v: number) => { const r = g.rows.find((x) => x[0] === label)!; r[col] = v; return g; };

describe("reading Odoo's Aged Receivable", () => {
  it("the as-of date, the buckets as named, every partner and document, and the report's total", () => {
    const r = readAged(receivable())!;
    expect(r.side).toBe("receivable");
    expect(r.asOf).toBe("2026-09-30");
    expect(r.buckets).toEqual(["At Date", "1-30", "31-60", "61-90", "91-120", "Older"]);
    expect(r.partners.map((p) => [p.name, p.total, p.items])).toEqual([["Northside Hospital", 1200, 2], ["مستشفى الشيخ زايد", 0, 2], ["Unknown", 290, 1]]);
    expect(r.items[0]).toEqual({ partner: "Northside Hospital", ref: "INV/2026/00101", memo: "September invoice", day: "2026-09-12", amounts: [1000, 0, 0, 0, 0, 0], total: 1000, row: 5 });
    expect(r.items[1]).toMatchObject({ ref: "INV/2026/00088", memo: "", day: "2026-08-20", total: 200 });
    expect(r.items[4]).toMatchObject({ partner: "Unknown", ref: "CIB/2026/0377", memo: "Inward ACH" });
    expect(r.total).toEqual({ amounts: [1000, 200, 0, 0, 0, 290], total: 1490 });
    expect(r.errors).toEqual([]);
  });

  it("says what an accountant would ask about: items with no partner, a partner netting to zero with open items, customers in credit", () => {
    const r = readAged(receivable())!;
    expect(r.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["no_partner", "nets_to_zero"]));
    expect(r.findings.find((f) => f.id === "nets_to_zero")!.message).toContain("مستشفى الشيخ زايد");
    let g = receivable();
    for (const [label, col, v] of [["INV/2026/00101 (September invoice)", 2, -1000], ["Northside Hospital", 2, -1000], ["Northside Hospital", 8, -800], ["Total Northside Hospital", 2, -1000], ["Total Northside Hospital", 8, -800]] as const) g = setRow(g, label, col, v);
    const credit = readAged(g)!;
    expect(credit.findings.map((f) => f.id)).toContain("credit_balance");
  });

  it("a partner whose total is zero while its buckets aren't (an old invoice against a newer credit) is named", () => {
    const g = receivable();
    const at = g.rows.findIndex((r) => r[0] === "Total Aged Receivable");
    g.rows.splice(at, 0,
      ["Delta Clinic", _, -500, _, _, _, _, 500, _],
      ["INV/2025/0901", _, _, _, _, _, _, 500, _],
      ["RINV/2026/0040", _, -500, _, _, _, _, _, _],
      ["Total Delta Clinic", _, -500, _, _, _, _, 500, _]);
    for (const label of ["Aged Receivable", "Total Aged Receivable"]) { setRow(g, label, 2, 500); setRow(g, label, 7, 790); }
    const r = readAged(g)!;
    expect(r.errors).toEqual([]);
    expect(r.findings.find((f) => f.id === "offset_buckets")!.message).toContain("Delta Clinic");
  });

  it("a document row whose buckets don't add up to the partner's total is an error naming the partner and bucket", () => {
    const r = readAged(setRow(receivable(), "INV/2026/00088", 3, 250))!;
    expect(r.errors.join(" ")).toMatch(/Northside Hospital.*1-30.*250.*200/);
  });

  it("partners that don't add up to the report's own total, and a header that disagrees with its Total row, are errors", () => {
    expect(readAged(setRow(receivable(), "Total Aged Receivable", 8, 1500))!.errors.join(" ")).toMatch(/report's total/i);
    expect(readAged(setRow(receivable(), "Northside Hospital", 8, 1300))!.errors.join(" ")).toMatch(/Northside Hospital/);
  });

  it("a document row outside any partner block is an error naming it, never skipped silently", () => {
    const g = receivable();
    g.rows.splice(8, 0, ["INV/2026/0999 (stray)", "09/01/2026", 5, _, _, _, _, _, 5]);
    expect(readAged(g)!.errors.join(" ")).toMatch(/Row 9: "INV\/2026\/0999 \(stray\)" looks like a document but no partner was opened above it/);
  });

  it("Aged Payable keeps Odoo's sign (positive = owed to the supplier) and older Odoo headings (Not due, 1 - 30) are read", () => {
    const g: Grid = { name: "Aged Payable", rows: [
      [_, "As of 30/06/2025"], [],
      [_, "Due Date", "Not due", "1 - 30", "31 - 60", "61 - 90", "91 - 120", "Older", "Total"],
      ["Aged Payable", _, 500, _, _, _, _, _, 500],
      ["Medline Supply", _, 500, _, _, _, _, _, 500],
      ["BILL/2025/0042 (Masks)", "15/07/2025", 500, _, _, _, _, _, _],
      ["Total Medline Supply", _, 500, _, _, _, _, _, 500],
      ["Total Aged Payable", _, 500, _, _, _, _, _, 500],
    ] };
    const r = readAged(g)!;
    expect(r.side).toBe("payable");
    expect(r.asOf).toBe("2025-06-30");
    expect(r.buckets[0]).toBe("Not due");
    expect(r.items[0]).toMatchObject({ day: "2025-07-15", total: 500 });
    expect(r.errors).toEqual([]);
  });

  it("a partner whose own name starts with \"Total\" (the company itself, \"Sample Trading Co\") is a partner, not a total", () => {
    const g = receivable();
    const at = g.rows.findIndex((r) => r[0] === "Total Aged Receivable");
    g.rows.splice(at, 0,
      ["Sample Trading Co", _, _, _, _, _, _, -100, -100],
      ["BMISR/2026/0067 (Check #68535519)", _, _, _, _, _, _, -100, _],
      ["Total Sample Trading Co", _, _, _, _, _, _, -100, -100]);
    for (const label of ["Aged Receivable", "Total Aged Receivable"]) { setRow(g, label, 7, 190); setRow(g, label, 8, 1390); }
    const r = readAged(g)!;
    expect(r.errors).toEqual([]);
    expect(r.partners.at(-1)).toMatchObject({ name: "Sample Trading Co", total: -100, items: 1 });
  });

  it("anything that isn't an aged report is not read as one", () => {
    expect(readAged({ name: "Sheet1", rows: [["Account", "Debit", "Credit"], ["Cash", 1, 0]] })).toBeNull();
  });
});

// The owner's own Odoo exports (never committed): every partner and the report's total must tie, to the cent.
const dir = process.env.AGED_DIR;
/** The same kind of report exported with Odoo's partner groups folded: one row per partner, totals only. */
function foldedPayable(): Grid {
  return {
    name: "Aged Payable", rows: [
      [_, "As of 10/15/2026"],
      [],
      H,
      ["Aged Payable", _, 200, -9686, _, _, _, -3906402.17, -4715866.15],
      ["Supplier Alpha", _, 200, -9686, _, _, _, _, -9486],
      ["Nebuliser Co", _, _, _, _, _, _, -3906402.17, -3906402.17],
      ["Unknown", _, _, _, _, _, _, _, 0],
      ["Total Aged Payable", _, 200, -9686, _, _, _, -3906402.17, -4715866.15],
    ],
  };
}

describe("reading a folded Aged Payable (partner totals only)", () => {
  it("each partner row is a partner with its own figures, one summary line each, and it says the documents are not in the file", () => {
    const r = readAged(foldedPayable())!;
    expect(r.errors).toEqual([]);
    expect(r.side).toBe("payable");
    expect(r.asOf).toBe("2026-10-15");
    expect(r.partners.map((p) => [p.name, p.total, p.items])).toEqual([["Supplier Alpha", -9486, 1], ["Nebuliser Co", -3906402.17, 1], ["Unknown", 0, 1]]);
    expect(r.items[0]).toMatchObject({ partner: "Supplier Alpha", ref: "", memo: "Partner total (documents not in the export)", day: null, amounts: [200, -9686, 0, 0, 0, 0], total: -9486 });
    expect(r.total.total).toBe(-4715866.15);
    expect(r.findings.find((f) => f.id === "folded")!.message).toMatch(/3 partners were exported folded \(totals only\)/);
  });

  it("a mixed export keeps the documents of the unfolded partner and the totals of the folded one", () => {
    const g = receivable();
    g.rows.splice(4, 0, ["Delta Clinic", _, _, _, _, _, _, 10, 10]);
    for (const r of [g.rows[3], g.rows[g.rows.length - 1]]) { r[7] = 300; r[8] = 1500; }
    const r = readAged(g)!;
    expect(r.errors).toEqual([]);
    expect(r.partners.find((p) => p.name === "Delta Clinic")).toMatchObject({ total: 10, items: 1 });
    expect(r.partners.find((p) => p.name === "Northside Hospital")!.items).toBe(2);
    expect(r.findings.find((f) => f.id === "folded")!.message).toMatch(/1 partner was exported folded/);
  });

  it("a folded partner whose own name starts with \"Total\" (the company itself) is a partner, and the figures still tie", () => {
    const g = foldedPayable();
    g.rows.splice(6, 0, ["Sample Trading Co", _, _, _, _, _, _, -22000, -22000]);
    for (const r of [g.rows[3], g.rows[g.rows.length - 1]]) { r[7] = -4728380.15; r[8] = -4737866.15; }
    const r = readAged(g)!;
    expect(r.errors).toEqual([]);
    expect(r.partners.find((p) => p.name === "Sample Trading Co")).toMatchObject({ total: -22000, items: 1 });
  });

  it("a folded row whose buckets don't add up to its Total is an error naming the row", () => {
    const g = setRow(foldedPayable(), "Supplier Alpha", 8, -9000);
    expect(readAged(g)!.errors.join(" ")).toMatch(/Row 5 \(Supplier Alpha\): its buckets add up to -9,486.00, its Total says -9,000.00/);
  });

  it("folded partners that don't add up to the report's total are an error", () => {
    const g = setRow(setRow(foldedPayable(), "Nebuliser Co", 7, -4706000), "Nebuliser Co", 8, -4706000);
    expect(readAged(g)!.errors.join(" ")).toMatch(/The partners add up to .* in "Older", the report's total says -3,906,402.17/);
  });
});

describe.skipIf(!dir)("real Aged Receivable / Payable (local only)", () => {
  const load = async (f: string) => { const b = fs.readFileSync(path.join(dir!, f)); return (await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, f))[0]; };
  it("the main company Sep 2026: receivable 417 partners, 1,501 documents, 310,920.00; payable 146 partners, 902 documents, 86,437.38", async () => {
    const ar = readAged(await load("aged_receivable_2026-09.xlsx"))!;
    expect([ar.side, ar.asOf, ar.partners.length, ar.items.length, ar.total.total, ar.errors]).toEqual(["receivable", "2026-09-30", 417, 1501, 310920.00, []]);
    expect(ar.total.amounts).toEqual([39860771.62, -6187846.56, -4243221.60, -15086863.83, 6421314.45, -20453497.14]);
    const ap = readAged(await load("aged_payable_2026-09.xlsx"))!;
    expect([ap.side, ap.asOf, ap.partners.length, ap.items.length, ap.total.total, ap.errors]).toEqual(["payable", "2026-09-30", 146, 902, 86437.38, []]);
  });
});
