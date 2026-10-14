import { describe, expect, it } from "vitest";
import sample from "../../reference/sample.json";
import { expensesAnalysis, expenseFlags, summariseExpenses, type ExpenseAccount, type MonthData } from "@/lib/engine";
import { expensesFromLedger, readExpenseGrid, type ExpenseLine } from "@/lib/ingest/expenses";
import { readSalesGrid } from "@/lib/ingest/sales";
import { parseExpenseSummary } from "@/lib/company/expenses-parse";
import { demoExpenseLines, demoExpenses } from "@/lib/company/demo-expenses";
import { spreadAccounts } from "@/lib/company/demo";
import type { Grid } from "@/lib/ingest/extract";

const entry = (day: string, ref: string, label: string, partner: string, amount: number) => ({ day, period: day.slice(0, 7), ref, label, partner, amount });

describe("expense lines from the General Ledger", () => {
  const lines = [
    { code: "6101", name: "Rent", cls: "exp_fixed" as const, excluded: false, entries: [entry("2026-01-05", "BILL/2026/0001", "Office rent Jan", "Landlord", 1000), entry("2026-01-31", "MISC/2026/0003", "MISC/2026/0003", "", -100)] },
    { code: "6900", name: "Depreciation", cls: "exp_depreciation" as const, excluded: false, entries: [entry("2026-01-31", "ASSTE/2026/0001", "Printer (1/60)", "Office Supplier", 50)] },
    { code: "4000", name: "Sales", cls: "revenue" as const, excluded: false, entries: [entry("2026-01-10", "INV/2026/0001", "[X] Mask", "Clinic", -500)] },
    { code: "6200", name: "Office", cls: "exp_fixed" as const, excluded: true, entries: [entry("2026-01-12", "BILL/2026/0002", "Ink", "Ink Co", 30)] },
    { code: "3100", name: "Dividends", cls: "dividends" as const, excluded: false, entries: [entry("2026-01-31", "MISC/2026/0009", "Dividend", "Owner", 900)] },
  ];
  it("keeps only cost accounts, with debit − credit as the amount", () => {
    const out = expensesFromLedger(lines);
    expect(out.map((l) => [l.account, l.supplier, l.series, l.amount])).toEqual([
      ["6101 Rent", "Landlord", "BILL", 1000],
      ["6101 Rent", "Journal entries", "MISC", -100],
      ["6900 Depreciation", "Depreciation (no payment)", "ASSTE", 50],
    ]);
    expect(out[0]).toMatchObject({ cls: "exp_fixed", category: "Rent", label: "Office rent Jan", day: "2026-01-05", period: "2026-01" });
  });
});

describe("reading a purchases export", () => {
  const odoo: Grid = { name: "Invoice Analysis", rows: [
    ["Invoice Date", "Number", "Vendor", "Product", "Product Category", "Account", "Untaxed Total"],
    ["05/01/2026", "BILL/2026/0001", "Medline Supply", "Masks", "Consumables", "500100 Cost of Goods Sold", -12000],
    ["06/01/2026", "BILL/2026/0002", "Nasr City Properties", "Office rent", "Services", "620200 Office Rent", -8000],
    ["07/02/2026", "RBILL/2026/0001", "Medline Supply", "Masks returned", "Consumables", "500100 Cost of Goods Sold", 1500],
    ["Total", "", "", "", "", "", -18500],
  ] };
  it("reads Odoo's vendor bills, turning their negative amounts into costs", () => {
    const r = readExpenseGrid(odoo)!;
    expect(r.layout).toMatchObject({ flipped: true, taxIncluded: false, lines: 3, total: 18500 });
    expect(r.lines.map((l) => [l.period, l.supplier, l.account, l.category, l.amount, l.cls])).toEqual([
      ["2026-01", "Medline Supply", "500100 Cost of Goods Sold", "Consumables", 12000, "cos_variable"],
      ["2026-01", "Nasr City Properties", "620200 Office Rent", "Services", 8000, "exp_fixed"],
      ["2026-02", "Medline Supply", "500100 Cost of Goods Sold", "Consumables", -1500, "cos_variable"],
    ]);
    expect(r.layout.trace.map((t) => t?.role)).toEqual(["header", "entry", "entry", "entry", "total"]);
  });
  it("is never read as sales, and a sales list is never read as expenses", () => {
    expect(readSalesGrid(odoo)).toBeNull();
    const partnerBills: Grid = { name: "Bills", rows: [["Date", "Number", "Partner", "Untaxed Amount"], ["05/01/2026", "BILL/2026/0001", "Medline", -100], ["06/01/2026", "BILL/2026/0002", "Nile", -50]] };
    expect(readSalesGrid(partnerBills)).toBeNull();
    expect(readExpenseGrid(partnerBills)!.lines.map((l) => l.amount)).toEqual([100, 50]);
    const sales: Grid = { name: "Sales", rows: [["Invoice Date", "Number", "Partner", "Product", "Untaxed Total"], ["05/01/2026", "INV/2026/0001", "Clinic", "Mask", 100]] };
    expect(readExpenseGrid(sales)).toBeNull();
    expect(readSalesGrid(sales)!.lines).toHaveLength(1);
    const gl: Grid = { name: "GL", rows: [["Code", "Account Name", "Date", "Partner", "Debit", "Credit", "Balance"], ["6101", "Rent", "05/01/2026", "Landlord", 1000, 0, 1000]] };
    expect(readExpenseGrid(gl)).toBeNull();
  });
  it("reads Arabic headings", () => {
    const g: Grid = { name: "فواتير", rows: [["التاريخ", "رقم الفاتورة", "المورد", "البند", "المبلغ قبل الضريبة"], ["15/03/2026", "F-1", "شركة النيل", "إيجار", "٢٬٥٠٠"]] };
    expect(readExpenseGrid(g)!.lines).toMatchObject([{ period: "2026-03", supplier: "شركة النيل", category: "إيجار", amount: 2500 }]);
  });
  it("a cell that cannot be read is an error at its row and column; a fix clears it", () => {
    const g: Grid = { name: "Bills", rows: [["Bill date", "Supplier", "Expense type", "Amount (excl. VAT)"], ["05/01/2026", "Landlord", "Rent", "eight thousand"], ["", "Ink Co", "Office", 30]] };
    const r = readExpenseGrid(g)!;
    expect(r.layout.errors.map((e) => e.message)).toEqual(['row 2, column D: "eight thousand" is not a number', "row 3, column A: no bill date on this line"]);
    expect(r.layout.taxIncluded).toBe(false);
    const fixed = readExpenseGrid(g, { cells: { "1:3": 8000 }, skipRows: [2] })!;
    expect(fixed.layout.errors).toEqual([]);
    expect(fixed.lines.map((l) => l.amount)).toEqual([8000]);
  });
});

describe("entries worth a look (same rules as the database)", () => {
  const l = (day: string, doc: string, supplier: string, account: string, amount: number, cls: ExpenseLine["cls"] = "exp_fixed"): ExpenseLine => ({ day, period: day.slice(0, 7), doc, series: doc.split("/")[0], supplier, account, cls, category: account, label: "", amount });
  const lines = [
    l("2026-01-05", "BILL/2026/0001", "Landlord", "6101 Rent", 1000), l("2026-02-05", "BILL/2026/0002", "Landlord", "6101 Rent", 1000),
    l("2026-03-05", "BILL/2026/0003", "Landlord", "6101 Rent", 1000), l("2026-04-05", "BILL/2026/0004", "Landlord", "6101 Rent", 1000),
    l("2026-04-10", "BILL/2026/0005", "Fixit", "6101 Rent", 9000), l("2026-04-11", "BILL/2026/0006", "Ink Co", "6200 Office", 250),
    l("2026-04-14", "BILL/2026/0007", "Ink Co", "6200 Office", 250),
    l("2026-02-11", "BILL/2026/0008", "Paper Co", "6200 Office", 80), l("2026-02-12", "BILL/2026/0009", "Paper Co", "6200 Office", 80), l("2026-02-14", "BILL/2026/0010", "Paper Co", "6200 Office", 80),
    l("2026-02-28", "ASSTE/2026/0001", "Depreciation (no payment)", "6900 Depreciation", 500, "exp_depreciation"),
  ];
  it("finds the large repair and the bill paid twice, not the regular purchase", () => {
    const f = expenseFlags(lines);
    expect(f.filter((x) => x.k === "large").map((x) => [x.doc, x.m])).toEqual([["BILL/2026/0005", 1000]]);
    expect(f.filter((x) => x.k === "double").map((x) => `${x.doc}+${x.doc2}`)).toEqual(["BILL/2026/0006+BILL/2026/0007"]);
  });
  it("the summary round-trips through the database's shape", () => {
    const s = summariseExpenses(lines);
    expect(parseExpenseSummary(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(s.accounts.find((a) => a.p === "2026-04" && a.t === "6101 Rent")!.a).toBe(10000);
    expect(s.suppliers.find((a) => a.p === "2026-04" && a.s === "Ink Co")).toMatchObject({ a: 500, d: 2, n: 2 });
  });
});

describe("expenses analysis, worked by hand", () => {
  const accts: ExpenseAccount[] = [
    { id: "r", code: "4000", name: "Sales", cls: "revenue", amounts: { "2026-01": 10000, "2026-02": 10000, "2026-03": 12000 } },
    { id: "a", code: "6101", name: "Rent", cls: "exp_fixed", amounts: { "2026-01": 1000, "2026-02": 1000, "2026-03": 1200 } },
    { id: "b", code: "5001", name: "Purchases", cls: "cos_variable", amounts: { "2026-01": 4000, "2026-02": 5000, "2026-03": 6000 } },
    { id: "c", code: "6300", name: "Legal", cls: "exp_fixed", amounts: { "2026-03": 800 } },
    { id: "d", code: "6900", name: "Depreciation", cls: "exp_depreciation", amounts: { "2026-01": 100, "2026-02": 100, "2026-03": 100 } },
  ];
  const revenue = { "2026-01": 10000, "2026-02": 10000, "2026-03": 12000 };
  it("totals, change, share of sales, recurring accounts and a bridge that adds up", () => {
    const a = expensesAnalysis(accts, summariseExpenses([]), { type: "month", end: "2026-03" }, 1, { revenue });
    expect([a.total, a.compare, a.growth]).toEqual([8100, 6100, (2000 / 6100) * 100]);
    expect(a.ofSales).toBeCloseTo(67.5, 6);
    expect(a.ofSalesCompare).toBeCloseTo(61, 6);
    expect(a.split).toEqual({ fixed: 2000, variable: 6000, depreciation: 100, other: 0 });
    expect(a.byGroup.map((g) => [g.name, g.amount])).toEqual([["Cost of sales", 6000], ["Running costs (fixed)", 2000], ["Depreciation", 100]]);
    expect(a.byAccount.map((r) => r.name)).toEqual(["5001 Purchases", "6101 Rent", "6300 Legal", "6900 Depreciation"]);
    expect(a.byAccount.reduce((s, r) => s + r.share, 0)).toBeCloseTo(100, 6);
    expect(a.bridge.reduce((s, b) => s + b.delta, 0)).toBeCloseTo(a.total - a.compare!, 6);
    expect(a.bridge[0]).toEqual({ name: "5001 Purchases", delta: 1000 });
    const q = expensesAnalysis(accts, summariseExpenses([]), { type: "quarter", end: "2026-03" }, 1, { revenue });
    expect(q.byAccount.find((r) => r.key === "a")!.recurring).toBe(true);
    expect(q.byAccount.find((r) => r.key === "c")!.recurring).toBe(false);
    expect(q.notes.some((n) => /Suppliers need expense lines/.test(n))).toBe(true);
    expect(a.findings.map((f) => f.title)).toContain("Costs grew faster than sales");
  });
});

describe("the demo company's expenses", () => {
  it("tie to the demo P&L costs account by account and month by month", () => {
    const lines = demoExpenseLines();
    for (const a of spreadAccounts(sample.months as MonthData[])) {
      for (const [p, v] of Object.entries(a.amounts)) {
        const got = lines.filter((l) => l.account === `${a.code} ${a.name}` && l.period === p).reduce((s, l) => s + l.amount, 0);
        if (["revenue", "other_income", "interest_income"].includes(a.cls) || !/^[5-7]/.test(a.code)) continue;
        expect(Math.round(got * 100) / 100, `${a.code} ${p}`).toBe(v);
      }
    }
  });
  it("show the planted large bill and the bill paid twice, and nothing else", () => {
    const f = demoExpenses().flags;
    expect(f.filter((x) => x.k === "large").map((x) => x.t)).toEqual(["620400 Professional Fees"]);
    expect(f.filter((x) => x.k === "double").map((x) => x.t)).toEqual(["610200 Delivery & Packaging"]);
  });
});

describe("the expenses template", () => {
  it("lines written as the template (CSV) read back identically", async () => {
    const { expensesCsv } = await import("@/lib/templates/fill");
    const { readWorkbook } = await import("@/lib/ingest/read");
    const lines: ExpenseLine[] = [
      { day: "2026-01-15", period: "2026-01", doc: "BILL/2026/0001", series: "BILL", supplier: "Nile, Co", account: "Rent", cls: "exp_fixed", category: "Rent", label: "January \"office\"", amount: 8000 },
      { day: null, period: "2026-02", doc: "", series: "", supplier: "No supplier", account: "Salaries", cls: "exp_fixed", category: "Salaries", label: "", amount: 25000.5 },
    ];
    const grids = await readWorkbook(new TextEncoder().encode(expensesCsv(lines, "EGP")).buffer as ArrayBuffer, "expenses.csv");
    const r = readExpenseGrid(grids[0])!;
    expect(r.layout.errors).toEqual([]);
    expect(r.layout.taxIncluded).toBe(false);
    expect(r.lines.map(({ src, ...l }) => (void src, l))).toEqual([lines[0], { ...lines[1], day: "2026-02-01" }]);
  });
  it("the downloadable template is marked, and a filled row with a mistake is caught at its cell", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { buildTemplate } = await import("@/lib/templates/build");
    const { readWorkbook } = await import("@/lib/ingest/read");
    const buf = await buildTemplate("expenses", { year: 2026, fyStart: 1, currency: "EGP" });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Expenses")!;
    ws.getCell("A5").value = new Date(Date.UTC(2026, 2, 3));
    ws.getCell("C5").value = "Landlord"; ws.getCell("D5").value = "Rent"; ws.getCell("F5").value = 9000;
    ws.getCell("A6").value = "next week"; ws.getCell("D6").value = "Fuel"; ws.getCell("F6").value = 300;
    const filled = Buffer.from(await wb.xlsx.writeBuffer());
    const grids = await readWorkbook(filled.buffer.slice(filled.byteOffset, filled.byteOffset + filled.byteLength) as ArrayBuffer, "filled.xlsx");
    const r = readExpenseGrid(grids.find((g) => /Expenses/.test(g.name))!)!;
    expect(r.lines.map((l) => [l.period, l.supplier, l.category, l.amount])).toEqual([["2026-03", "Landlord", "Rent", 9000]]);
    expect(r.layout.errors.map((e) => e.message)).toEqual(['row 6, column A: "next week" is not a date']);
  });
});
