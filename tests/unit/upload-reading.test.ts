import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { bsCalc, plCalc } from "@/lib/engine";
import { buildMonths } from "@/lib/company/build";
import { ingest, type IngestOptions, type IngestResult } from "@/lib/ingest/pipeline";
import { readWorkbook } from "@/lib/ingest/read";
import { readSalesGrid } from "@/lib/ingest/sales";
import { financialIssues, finalTrace, salesIssues, sortedFinancials } from "@/lib/ingest/sorted";
import { extractAll } from "@/lib/ingest/pipeline";
import { buildTemplate } from "@/lib/templates/build";
import { financialsFill, salesCsv } from "@/lib/templates/fill";
import { corpus } from "../fixtures/egypt-corpus";
import type { Grid } from "@/lib/ingest/extract";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-12" };
const PL: Grid = { name: "P&L", rows: [
  ["Profit and Loss"], [],
  ["Account", "Jan 2026", "Feb 2026", "Mar 2026"],
  ["Revenue", null, null, null],
  ["Sales", 1000, 1200, 1100],
  ["Cost of sales", 600, "seven hundred", 650],
  ["Expenses", null, null, null],
  ["Rent", 100, 100, 100],
  ["Note", "Actual", "Actual", "Actual"],
  ["Net profit", 300, 400, 350],
] };

describe("reading an upload row by row (the 'Your file' box)", () => {
  it("an amount that is text is an error at its row and column, never a heading or a zero", () => {
    const res = ingest([PL], OPTS);
    const errs = res.layouts[0].cellErrors!;
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ row: 5, col: 2, text: "seven hundred" });
    expect(errs[0].message).toBe('row 6, column C: "seven hundred" is not a number');
    // The row is still the account it is (with the readable months), marked as an error.
    expect(res.lines.find((l) => l.name === "Cost of sales")?.values).toMatchObject({ "2026-01": 600, "2026-03": 650 });
    expect(res.layouts[0].trace![5]).toMatchObject({ role: "error" });
    expect(financialIssues(res).filter((i) => i.severity === "error").map((i) => i.fix)).toEqual(["cell"]);
  });

  it("text across every month column with no figure is a heading row, not an error", () => {
    const res = ingest([PL], OPTS);
    expect(res.layouts[0].trace![8]).toMatchObject({ role: "heading" });
    expect(res.layouts[0].cellErrors!.some((e) => e.row === 8)).toBe(false);
  });

  it("a retyped cell is read as typed, and a row left out disappears; the uploaded grid is unchanged", () => {
    const fixed = ingest([PL], OPTS, { "P&L": { cells: { "5:2": 700 } } });
    expect(fixed.layouts[0].cellErrors).toEqual([]);
    expect(fixed.lines.find((l) => l.name === "Cost of sales")?.values["2026-02"]).toBe(700);
    expect(PL.rows[5][2]).toBe("seven hundred");
    const skipped = ingest([PL], OPTS, { "P&L": { skipRows: [5] } });
    expect(skipped.lines.some((l) => l.name === "Cost of sales")).toBe(false);
    expect(skipped.layouts[0].trace![5]).toMatchObject({ role: "skipped", note: "left out by you" });
    expect(skipped.layouts[0].cellErrors).toEqual([]);
  });

  it("every row says where it went: headings, accounts, the printed total (left out: iReport works it out)", () => {
    const res = ingest([PL], OPTS, { "P&L": { cells: { "5:2": 700 } } });
    const t = finalTrace(res.layouts[0], res).map((x) => x?.role);
    expect(t).toEqual(["title", undefined, "header", "heading", "account", "account", "heading", "account", "heading", "total"]);
    const sorted = sortedFinancials(res, extractAll([PL], { "P&L": { cells: { "5:2": 700 } } }, OPTS.today).raw);
    expect(sorted.leftOut.map((o) => [o.label, o.why])).toEqual([["Net profit", "a total: iReport works out totals itself"]]);
  });

  it("every file of the corpus is traced completely, with no false errors", async () => {
    for (const f of corpus()) {
      const grids = await readWorkbook(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer, f.name);
      const res = ingest(grids, { ...OPTS, ...f.opts });
      for (const l of res.layouts) {
        const g = grids.find((x) => x.name === l.sheet)!;
        expect(l.cellErrors ?? [], `${f.name} ${l.sheet}`).toEqual([]);
        g.rows.forEach((r, i) => { if (r?.some((c) => c !== null && c !== undefined && String(c).trim() !== "")) expect(l.trace?.[i], `${f.name} ${l.sheet} row ${i + 1}`).toBeTruthy(); });
        const refs = new Set((l.trace ?? []).map((t) => t?.ref).filter(Boolean));
        for (const line of res.lines.filter((x) => x.sheet === l.sheet && !x.system)) expect(refs.has(line.key), `${f.name}: ${line.label}`).toBe(true);
      }
    }
  });
});

describe("iReport's sorted reading (the right box)", () => {
  it("groups accounts by class in statement order, with totals equal to the engine's", async () => {
    const f = corpus().find((x) => x.name === "en-pl-bs-monthly.xlsx")!;
    const grids = await readWorkbook(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer, f.name);
    const res = ingest(grids, OPTS);
    const s = sortedFinancials(res, extractAll(grids, {}, OPTS.today).raw);
    expect(s.pl[0].cls).toBe("revenue");
    expect(s.bs[0].cls).toBe("cash");
    const months = new Map(buildMonths(res.lines.filter((l) => l.cls && !l.excluded).map((l) => ({ id: l.key, code: l.code, name: l.name, cls: l.cls!, amounts: l.values }))).map((m) => [m.period, m]));
    for (const p of s.plPeriods) expect(s.plTotals.find((t) => t.label === "Net profit")!.values[p]).toBeCloseTo(plCalc(months.get(p)!.pl).net_income, 6);
    for (const p of s.bsPeriods) {
      expect(s.bsTotals.find((t) => t.label === "Total assets")!.values[p]).toBeCloseTo(bsCalc(months.get(p)!.bs).ta, 6);
      expect(Math.abs(s.bsTotals.find((t) => t.zero)!.values[p])).toBeLessThan(1);
    }
    expect(financialIssues(res).filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("sales rows that cannot be read are errors to fix, never dropped silently", () => {
  const g: Grid = { name: "Invoices", rows: [
    ["Invoice Date", "Number", "Customer", "Product", "Untaxed Total"],
    ["15/01/2026", "INV/1", "Clinic A", "Mask", 100],
    ["", "INV/2", "Clinic B", "Mask", 200],
    ["20/01/2026", "INV/3", "Clinic C", "Mask", "two hundred"],
    ["21/01/2026", "INV/4", "Clinic D", "Mask", 0],
  ] };
  it("names the row and column of each, and keeps the good lines", () => {
    const r = readSalesGrid(g)!;
    expect(r.lines.map((l) => l.doc)).toEqual(["INV/1"]);
    expect(r.layout.errors.map((e) => e.message)).toEqual(["row 3, column A: no invoice date on this line", 'row 4, column E: "two hundred" is not a number']);
    expect(r.layout.trace.map((t) => t?.role)).toEqual(["header", "entry", "error", "error", "unused"]);
    expect(salesIssues([r.layout]).filter((i) => i.severity === "error")).toHaveLength(2);
  });
  it("a date typed in the box and a row left out clear them", () => {
    const r = readSalesGrid(g, { cells: { "2:0": "16/01/2026" }, skipRows: [3] })!;
    expect(r.layout.errors).toEqual([]);
    expect(r.lines.map((l) => [l.doc, l.day])).toEqual([["INV/1", "2026-01-15"], ["INV/2", "2026-01-16"]]);
    expect(r.layout.trace[3]).toMatchObject({ role: "skipped" });
  });
});

describe("downloading the sorted reading as iReport's template gives the same figures back", () => {
  it("financials: a General Ledger read, sorted, written as the filled template and read again", async () => {
    const f = corpus().find((x) => x.name === "ar-gl-generic.xlsx")!;
    const grids = await readWorkbook(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer, f.name);
    const res = ingest(grids, { ...OPTS, ...f.opts });
    const sorted = sortedFinancials(res, extractAll(grids, {}, OPTS.today).raw);
    const buf = await buildTemplate("financials", { year: 2026, fyStart: 1, currency: "EGP", fill: financialsFill(sorted) });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const again = ingest(await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "filled.xlsx"), OPTS);
    expect(again.layouts.flatMap((l) => l.cellErrors ?? [])).toEqual([]);
    const totals = (r: IngestResult) => {
      const ms = buildMonths(r.lines.filter((l) => l.cls && !l.excluded).map((l) => ({ id: l.key, code: l.code, name: l.name, cls: l.cls!, amounts: l.values })));
      return Object.fromEntries(ms.map((m) => [m.period, { rev: plCalc(m.pl).revenue, ni: Math.round(plCalc(m.pl).net_income * 100) / 100, ta: Math.round(bsCalc(m.bs).ta * 100) / 100, imb: Math.round(bsCalc(m.bs).imbalance) }]));
    };
    expect(totals(again)).toEqual(totals(res));
  });

  it("sales: the lines written as the sales template (CSV) read back identically", async () => {
    const lines = [
      { day: "2026-01-15", period: "2026-01", doc: "INV/2026/0001", series: "INV", customer: "Clinic, A", product: "Concentrator", category: "Devices", salesperson: "Sara", qty: 2, amount: 20000, cost: 13000 },
      { day: null, period: "2026-02", doc: "", series: "", customer: "عميل ١", product: "Mask \"M\"", category: "No category", salesperson: "", qty: null, amount: -260.5, cost: null },
    ];
    const csv = salesCsv(lines, "EGP");
    const grids = await readWorkbook(new TextEncoder().encode(csv).buffer as ArrayBuffer, "sales.csv");
    const r = readSalesGrid(grids[0])!;
    expect(r.layout.errors).toEqual([]);
    expect(r.lines.map(({ src, ...l }) => (void src, l))).toEqual([lines[0], { ...lines[1], day: "2026-02-01" }]);
  });
});
