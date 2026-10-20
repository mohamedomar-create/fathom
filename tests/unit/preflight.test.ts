// Spreadsheet preflight: before anything is imported, each sheet gets one status (ready / ready after fixes / cannot
// import yet) with every issue placed on its sheet, rows and columns, split into safe automatic fixes and decisions for
// the person. Nothing is guessed, the original is never changed, and the cleaned copy reads back the same.
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { readWorkbook } from "@/lib/ingest/read";
import { cleanWorkbook, inspectWorkbook, runPreflight, toCsv, toXlsx, supportedFile, type Decisions } from "@/lib/preflight";

const d = (s: string) => new Date(`${s}T00:00:00`);
const codes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code).sort();
const issue = (r: { issues: { code: string }[] }, code: string) => r.issues.find((i) => i.code === code) as { code: string; fix: string; level: string; rows?: number[]; cols?: string[]; action: string; needs?: string } | undefined;

// A sales export with a title above the headings, a blank row, a duplicate line, a line with no amount and a total row.
const messySales = (): Grid => ({
  name: "Invoices",
  rows: [
    ["Invoice analysis – Sep 2026", null, null, null],
    [null, null, null, null],
    ["Date", "Number", "Customer", "Untaxed Amount"],
    [d("2026-09-01"), "INV/1", "Alpha", 100],
    [d("2026-09-02"), "INV/2", "Beta", 50],
    [null, null, null, null],
    [d("2026-09-02"), "INV/2", "Beta", 50],
    [d("2026-09-03"), "INV/3", "Gamma", null],
    ["Total", null, null, 200],
  ],
});

describe("a messy sales sheet", () => {
  const r = inspectWorkbook([messySales()], "sales");
  const s = r.sheets[0];
  it("is ready after fixes, with the heading row found below row 1", () => {
    expect(s.status).toBe("ready_after_fixes");
    expect(s.headerRowNo).toBe(3);
    expect(codes(s)).toEqual(["blank_rows", "duplicates", "header_below", "missing_values", "total_rows"]);
  });
  it("names rows as the spreadsheet numbers them, and splits automatic fixes from decisions", () => {
    expect(issue(s, "blank_rows")).toMatchObject({ fix: "auto", rows: [6] });
    expect(issue(s, "total_rows")).toMatchObject({ fix: "auto", rows: [9] });
    expect(issue(s, "duplicates")).toMatchObject({ fix: "decision", rows: [5, 7] });
    expect(issue(s, "missing_values")).toMatchObject({ fix: "decision", rows: [8], cols: ["D"] });
    expect(issue(s, "missing_values")!.needs).toMatch(/amount/i);
  });
  it("maps columns only where the heading says what they are", () => {
    expect(s.columns.map((c) => c.field)).toEqual(["date", "doc", "customer", "untaxed"]);
  });

  it("cleans with the person's decisions, leaving the original untouched", () => {
    const original = messySales();
    const before = JSON.stringify(original);
    const decisions: Decisions = { Invoices: { duplicates: "keep_first", dropMissing: true } };
    const out = cleanWorkbook([original], inspectWorkbook([original], "sales"), decisions);
    expect(JSON.stringify(original)).toBe(before);
    expect(out.grids[0].rows).toEqual([
      ["Date", "Number", "Customer", "Untaxed Amount"],
      ["2026-09-01", "INV/1", "Alpha", 100],
      ["2026-09-02", "INV/2", "Beta", 50],
    ]);
    expect(out.rejected.map((x) => [x.row, x.reason])).toEqual([[7, "duplicate of row 5"], [8, "no Untaxed Amount"]]);
    expect(out.changes.map((c) => c.kind).sort()).toEqual(["blank_rows", "dates", "duplicates", "missing_values", "title_rows", "total_rows"]);
    const again = inspectWorkbook(out.grids, "sales", { decisions });
    expect(again.sheets[0].status).toBe("ready");
    expect(again.ready).toBe(true);
  });
});

describe("what blocks an import", () => {
  it("a missing required column: cannot import yet, saying what the module needs", () => {
    const s = inspectWorkbook([{ name: "S", rows: [["Date", "Customer"], [d("2026-09-01"), "A"]] }], "sales").sheets[0];
    expect(s.status).toBe("cannot_import");
    expect(issue(s, "missing_column")).toMatchObject({ level: "block", fix: "decision" });
    expect(issue(s, "missing_column")!.needs).toMatch(/Untaxed amount or Total/);
  });
  it("a column the person maps clears it, and the cleaned copy carries the heading the import reads", () => {
    const g: Grid = { name: "S", rows: [["Date", "Client", "Net EGP"], [d("2026-09-01"), "A", 10]] };
    const decisions: Decisions = { S: { map: { untaxed: 2, customer: 1 } } };
    const r = inspectWorkbook([g], "sales", { decisions });
    expect(r.sheets[0].status).toBe("ready");
    const out = cleanWorkbook([g], r, decisions);
    expect(out.grids[0].rows[0]).toEqual(["Date", "Customer", "Untaxed Amount"]);
  });
  it("two columns that could both be the amount are never chosen for the person", () => {
    const s = inspectWorkbook([{ name: "S", rows: [["Date", "Subtotal", "Untaxed Amount"], [d("2026-09-01"), 1, 1]] }], "sales").sheets[0];
    expect(issue(s, "ambiguous_column")).toMatchObject({ fix: "decision", cols: ["B", "C"] });
    expect(s.status).toBe("ready_after_fixes");
  });
  it("an empty sheet, and a sheet that belongs to no import, cannot be imported", () => {
    const r = inspectWorkbook([{ name: "Blank", rows: [] }, { name: "Notes", rows: [["Prepared by finance"], ["Do not edit"]] }], "sales");
    expect(r.sheets.map((s) => [s.status, codes(s)[0], s.include])).toEqual([["cannot_import", "empty", false], ["cannot_import", "irrelevant", false]]);
    expect(r.ready).toBe(false);
  });
  it("a hidden sheet and a copied tab are left out unless the person includes them", () => {
    const a = messySales();
    const r = inspectWorkbook([{ ...a, name: "Copy" }, a, { ...a, name: "Hidden", hidden: true }], "sales");
    const [copy, , hidden] = r.sheets;
    expect(copy).toMatchObject({ copyOf: "Invoices", include: false });
    expect(issue(copy, "duplicate_sheet")!.fix).toBe("decision");
    expect(hidden).toMatchObject({ hidden: true, include: false });
    expect(issue(hidden, "hidden_sheet")!.fix).toBe("decision");
    expect(inspectWorkbook([{ ...a, name: "Hidden", hidden: true }], "sales", { decisions: { Hidden: { include: true } } }).sheets[0].include).toBe(true);
  });
});

describe("values", () => {
  it("numbers stored as text are read; text that is no number is listed by row", () => {
    const s = inspectWorkbook([{ name: "S", rows: [["Date", "Untaxed Amount"], [d("2026-09-01"), "1,250.50"], [d("2026-09-02"), "n/a"], [d("2026-09-03"), 4]] }], "sales").sheets[0];
    expect(issue(s, "text_numbers")).toMatchObject({ fix: "auto", rows: [2], cols: ["B"] });
    expect(issue(s, "invalid_numbers")).toMatchObject({ fix: "decision", rows: [3], cols: ["B"] });
  });
  it("dates written several ways are unified once their day/month order is proven", () => {
    const s = inspectWorkbook([{ name: "S", rows: [["Date", "Untaxed Amount"], [d("2026-09-01"), 1], ["2026-09-02", 1], ["13/09/2026", 1], ["03/09/2026", 1]] }], "sales").sheets[0];
    expect(issue(s, "date_formats")).toMatchObject({ fix: "auto", cols: ["A"] });
    expect(s.dateOrder).toBe("dmy");
    expect(issue(s, "date_order")).toBeUndefined();
  });
  it("dates whose day/month order nothing proves are a decision, never a guess", () => {
    const s = inspectWorkbook([{ name: "S", rows: [["Date", "Untaxed Amount"], ["03/04/2026", 1], ["05/06/2026", 1]] }], "sales").sheets[0];
    expect(issue(s, "date_order")).toMatchObject({ fix: "decision", cols: ["A"] });
    const r = inspectWorkbook([{ name: "S", rows: [["Date", "Untaxed Amount"], ["03/04/2026", 1]] }], "sales", { decisions: { S: { dateOrder: "mdy" } } });
    expect(issue(r.sheets[0], "date_order")).toBeUndefined();
    expect(cleanWorkbook([{ name: "S", rows: [["Date", "Untaxed Amount"], ["03/04/2026", 1]] }], r, { S: { dateOrder: "mdy" } }).grids[0].rows[1][0]).toBe("2026-03-04");
  });
  it("more than one currency is a decision", () => {
    const s = inspectWorkbook([{ name: "S", rows: [["Date", "Untaxed Amount", "Currency"], [d("2026-09-01"), 1, "EGP"], [d("2026-09-02"), 2, "USD"]] }], "sales").sheets[0];
    expect(issue(s, "currencies")).toMatchObject({ fix: "decision", cols: ["C"] });
    expect(issue(s, "currencies")!.action).toMatch(/EGP.*USD|USD.*EGP/);
  });
  it("formulas and spreadsheet errors are named", () => {
    const s = inspectWorkbook([{ name: "S", rows: [["Date", "Untaxed Amount"], [d("2026-09-01"), 3], [d("2026-09-02"), "#REF!"]], formulas: { "1:1": "1+2" }, broken: 1 }], "sales").sheets[0];
    expect(issue(s, "formulas")).toMatchObject({ level: "info" });
    expect(issue(s, "error_cells")).toMatchObject({ fix: "decision", rows: [3], cols: ["B"] });
  });
  it("a column of mixed kinds outside the needed fields is reported, not used", () => {
    const s = inspectWorkbook([{ name: "S", rows: [["Date", "Untaxed Amount", "Notes"], [d("2026-09-01"), 3, "x"], [d("2026-09-02"), 4, 5]] }], "sales").sheets[0];
    expect(issue(s, "unused_columns")!.cols).toEqual(["C"]);
  });
});

describe("module rules", () => {
  it("an agency statement laid out by month across columns cannot be imported", () => {
    const s = inspectWorkbook([{ name: "P", rows: [["Hospital", "Jan 2026", "Feb 2026", "Mar 2026"], ["A", 1, 2, 3]] }], "agency").sheets[0];
    expect(s.status).toBe("cannot_import");
    expect(codes(s)).toContain("pivot");
  });
  it("a stock valuation export without its quantity column cannot be imported", () => {
    const s = inspectWorkbook([{ name: "V", rows: [["Date", "Product", "Reference", "Total Value"], [d("2026-09-01"), "[A1] Pump", "WH/IN/1", 10]] }], "stock").sheets[0];
    expect(s.status).toBe("cannot_import");
    expect(issue(s, "missing_column")!.needs).toMatch(/Quantity/);
  });
  it("a payments list without amounts says which headings are missing", () => {
    const s = inspectWorkbook([{ name: "Pay", rows: [["id", "partner_id", "date", "journal_id", "name", "state"], [1, "A", "2026-09-01", "Bank", "P1", "posted"]] }], "payments").sheets[0];
    expect(s.status).toBe("cannot_import");
    expect((issue(s, "missing_column") as unknown as { message: string }).message).toMatch(/Amount/);
  });
  it("a trial balance on the accounts step is ready; its blank rows are only noted", () => {
    const s = inspectWorkbook([{ name: "TB", rows: [["Code", "Account", "Debit", "Credit"], ["110100", "Cash", 100, 0], [null, null, null, null], ["310000", "Capital", 0, 100]] }], "accounts").sheets[0];
    expect(s.status).toBe("ready");
    expect(issue(s, "blank_rows")).toMatchObject({ level: "info" });
  });
});

describe("an agency statement", () => {
  it("collection rows (no value) are not lines and the End row is checked as a total, as the statement reader does", () => {
    const g: Grid = { name: "UPA SOA", rows: [
      ["Date", "DN #", "Name", "Value"],
      [d("2026-09-01"), "1", "Shifa Hospital", 100],
      [d("2026-09-05"), "", "Shifa Hospital", null],
      [d("2026-09-07"), "2", "Nour Hospital", 50],
      ["End", null, null, 150],
    ] };
    const r = runPreflight([g], "agency", {});
    expect(r.report.sheets[0].status).toBe("ready_after_fixes");
    expect(codes(r.report.sheets[0])).toEqual(["blank_rows", "total_rows"]);
    expect(r.final.ready).toBe(true);
    expect(r.cleaned.grids[0].rows.map((x) => x[3])).toEqual(["Value", 100, null, 50]);
  });
});

describe("files", () => {
  it("only spreadsheet files go through preflight", () => {
    expect(["a.xlsx", "b.XLS", "c.csv", "d.txt", "e.tsv"].every(supportedFile)).toBe(true);
    expect(supportedFile("e.docx")).toBe(false);
  });
  it("the cleaned copy downloads as XLSX and CSV that read back to the same rows", async () => {
    const g: Grid = { name: "Invoices", rows: [["Date", "Customer", "Untaxed Amount"], ["2026-09-01", "Alpha", 100], ["2026-09-02", "Beta, Ltd", 50.5]] };
    const x = await toXlsx([g]);
    const back = await readWorkbook(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer, "clean.xlsx");
    expect(back[0].rows).toEqual(g.rows);
    const csv = toCsv(g);
    expect(csv.split("\n")[2]).toBe('2026-09-02,"Beta, Ltd",50.5');
    const back2 = await readWorkbook(new TextEncoder().encode(csv).buffer as ArrayBuffer, "clean.csv");
    expect(back2[0].rows).toEqual(g.rows);
  });
  it("the reader says which sheets are hidden and how many cells were merged", async () => {
    const XLSX = await import("@e965/xlsx");
    const wb = XLSX.utils.book_new();
    const a = XLSX.utils.aoa_to_sheet([["Title"], ["Date", "Amount"], ["2026-09-01", 1]]);
    a["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
    XLSX.utils.book_append_sheet(wb, a, "Visible");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["x"]]), "Helper");
    wb.Workbook = { Sheets: [{ name: "Visible", Hidden: 0 }, { name: "Helper", Hidden: 1 }] };
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const grids = await readWorkbook(buf, "t.xlsx");
    expect(grids.map((g) => [g.name, Boolean(g.hidden), g.merges ?? 0])).toEqual([["Visible", false, 1], ["Helper", true, 0]]);
  });
});
