import { describe, expect, it } from "vitest";
import type { ClassKey } from "@/lib/engine";
import { ingest } from "@/lib/ingest/pipeline";
import { checkTable, columnHeading, groupPages, pdfChecks, pdfGrids, recheckList, type PdfPage } from "@/lib/ingest/pdf";
import { PageSchema, type PageRead, type PageRow } from "@/lib/ingest/pdf-schema";

const row = (label: string, values: (number | null)[], o: Partial<PageRow> = {}): PageRow => ({ code: "", label, values, total: false, heading: false, unclear: false, ...o });
const tot = (label: string, values: number[]) => row(label, values, { total: true });
const head = (label: string) => row(label, [], { heading: true });
const page = (p: Partial<PageRead> & Pick<PageRead, "kind" | "rows">): PageRead => ({ title: "", company: "Delta Trading S.A.E.", currency: "EGP", scale: "units", dateText: "", columns: ["2025", "2024"], ...p });

// The audited statements of annual-statements.test.ts, as the reader returns them from a scanned PDF (costs shown in brackets).
const PL = page({
  kind: "pl", title: "Income statement", dateText: "For the year ended 31 December 2025",
  rows: [
    row("Revenue", [12000000, 9500000]), row("Cost of sales", [-8000000, -6500000]), tot("Gross profit", [4000000, 3000000]),
    row("Selling and distribution expenses", [-900000, -700000]), row("General and administrative expenses", [-1100000, -1000000]),
    row("Depreciation", [-300000, -250000]), row("Finance costs", [-450000, -300000]), tot("Profit before tax", [1250000, 750000]),
    row("Income tax", [-281250, -168750]), tot("Net profit for the year", [968750, 581250]),
  ],
});
const BS = page({
  kind: "bs", title: "Statement of financial position", dateText: "As at 31 December 2025",
  rows: [
    head("Assets"), row("Property, plant and equipment", [2500000, 2300000]), row("Inventories", [1800000, 1400000]), row("Trade receivables", [3200000, 2200000]),
    row("Cash and cash equivalents", [600000, 800000]), tot("Total assets", [8100000, 6700000]),
    head("Equity and liabilities"), row("Share capital", [2000000, 2000000]), row("Retained earnings", [2068750, 1100000]), tot("Total equity", [4068750, 3100000]),
    row("Long-term loans", [900000, 1000000]), row("Current portion of long-term loans", [300000, 0]), row("Bank overdraft", [1100000, 900000]),
    row("Trade payables", [1450000, 1450000]), row("Income tax payable", [281250, 250000]),
    tot("Total liabilities", [4031250, 3600000]), tot("Total equity and liabilities", [8100000, 6700000]),
  ],
});
const pages = (...reads: PageRead[]): PdfPage[] => reads.map((read, i) => ({ file: "statements.pdf", n: i + 1, read }));

function totals(res: Awaited<ReturnType<typeof ingest>>, p: string) {
  const t: Partial<Record<ClassKey, number>> = {};
  for (const l of res.lines) if (l.cls && !l.excluded) t[l.cls] = (t[l.cls] ?? 0) + (l.values[p] ?? 0);
  return t;
}
const run = (ps: PdfPage[]) => ingest(pdfGrids(ps), { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-10" });

describe("reading statements from PDF pages", () => {
  it("the reader's answer shape is what the schema accepts", () => {
    expect(PageSchema.safeParse(PL).success).toBe(true);
    expect(PageSchema.safeParse({ ...PL, scale: "billions" }).success).toBe(false);
  });

  it("a P&L page and a balance sheet page give the same figures as the Excel file, both years balancing", async () => {
    const res = await run(pages(PL, BS));
    expect(res.periods).toEqual(expect.arrayContaining(["2024-12", "2025-12"]));
    expect(res.imbalance["2025-12"]).toBeCloseTo(0, 2);
    expect(res.imbalance["2024-12"]).toBeCloseTo(0, 2);
    const t = totals(res, "2025-12");
    expect(t.revenue).toBe(12000000);
    expect(t.tax_expenses).toBe(281250);
    expect(t.interest_expenses).toBe(450000);
    expect(t.ltd).toBe(900000);
    expect(t.cash).toBe(600000);
  });

  it("figures printed in thousands are scaled", async () => {
    const k = (p: PageRead): PageRead => ({ ...p, scale: "thousands", rows: p.rows.map((r) => ({ ...r, values: r.values.map((v) => (v === null ? null : v / 1000)) })) });
    const t = totals(await run(pages(k(PL), k(BS))), "2025-12");
    expect(t.revenue).toBe(12000000);
    expect(t.tax_expenses).toBe(281250);
  });

  it("a table over two pages is one sheet; different tables stay apart", () => {
    const a = page({ kind: "bs", rows: BS.rows.slice(0, 6) }), b = page({ kind: "bs", rows: BS.rows.slice(6) });
    const ps = pages(PL, a, b);
    expect(groupPages(ps).map((g) => g.map((p) => p.n))).toEqual([[1], [2, 3]]);
    expect(pdfGrids(ps)[1].name).toContain("pages 2–3");
    // A cover or notes page is skipped.
    expect(groupPages(pages(page({ kind: "other", columns: [], rows: [] }), PL)).map((g) => g[0].n)).toEqual([2]);
  });

  it("column headings are dated the way the importer reads them", () => {
    expect(columnHeading("31 December 2025", "bs")).toBe("31/12/2025");
    expect(columnHeading("Year ended 31 ديسمبر ٢٠٢٥", "bs")).toBe("31/12/2025");
    // Already readable: kept as printed.
    expect(columnHeading("31 ديسمبر 2025", "bs")).toBe("31 ديسمبر 2025");
    expect(columnHeading("Year ended 30 June 2025", "pl")).toBe("From 01/07/2024 to 30/06/2025");
    expect(columnHeading("30/09/2025", "pl", "For the nine months ended 30 September 2025")).toBe("From 01/01/2025 to 30/09/2025");
    expect(columnHeading("2025", "pl")).toBe("2025");
    expect(columnHeading("Debit", "tb")).toBe("Debit");
  });
});

describe("checking that what was read adds up", () => {
  it("correct statements pass: subtotals, gross profit as revenue less cost, grand totals, balance", () => {
    expect(pdfChecks(pages(PL, BS))).toEqual([]);
    const pos = page({ kind: "pl", columns: ["2025"], rows: [row("Revenue", [100]), row("Cost of sales", [60]), tot("Gross profit", [40]), row("Expenses", [15]), tot("Net profit", [25])] });
    expect(pdfChecks(pages(pos))).toEqual([]);
  });

  it("a misread figure is caught at the total it breaks, and named for a second look", () => {
    const bad = { ...BS, rows: BS.rows.map((r) => (r.label === "Inventories" ? { ...r, values: [1300000, 1400000] } : r)) };
    const flags = checkTable(pages(bad));
    expect(flags[0]).toMatchObject({ page: 1, kind: "total" });
    expect(flags[0].text).toContain("Total assets");
    expect(recheckList({ file: "statements.pdf", n: 1, read: bad }, flags)[0]).toContain("Total assets");
  });

  it("a balance sheet that does not balance is named", () => {
    const off = page({ kind: "bs", columns: ["2025"], rows: [row("Cash", [100]), tot("Total assets", [100]), row("Capital", [90]), tot("Total equity and liabilities", [90])] });
    expect(checkTable(pages(off)).map((f) => f.kind)).toEqual(["balance"]);
  });

  it("a trial balance whose debits and credits differ is named; unclear rows are listed but not re-read", () => {
    const tb = page({ kind: "tb", columns: ["Debit", "Credit"], rows: [row("Cash", [500, null]), row("Capital", [null, 400], { unclear: true }), row("Sales", [null, 90])] });
    const flags = checkTable(pages(tb));
    expect(flags.map((f) => f.kind)).toEqual(["unclear", "debit_credit"]);
    expect(recheckList({ file: "statements.pdf", n: 1, read: tb }, flags)).toHaveLength(1);
  });
});
