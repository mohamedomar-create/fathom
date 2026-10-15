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

describe("ledgers from any system feed Sales and Expenses, tying to the P&L", () => {
  it("generic General Ledgers and journal lists keep their dated lines", async () => {
    const { corpus } = await import("../fixtures/egypt-corpus");
    const { readWorkbook } = await import("@/lib/ingest/read");
    const { ingest } = await import("@/lib/ingest/pipeline");
    const { salesFromLedger } = await import("@/lib/ingest/sales");
    const { EXPENSE_CLASSES } = await import("@/lib/ingest/expenses");
    for (const name of ["ar-gl-generic.xlsx", "journal-dmy-eu.csv", "journal-ar-digits.xlsx", "journal-excel-dates.xlsx"]) {
      const f = corpus().find((x) => x.name === name)!;
      const grids = await readWorkbook(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer, f.name);
      const res = ingest(grids, { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-12", ...f.opts });
      const sum = (ls: { period: string; amount: number }[], p: string) => ls.filter((l) => l.period === p).reduce((s, l) => s + l.amount, 0);
      const sales = salesFromLedger(res.lines), exp = expensesFromLedger(res.lines);
      expect(sales.length, name).toBeGreaterThan(0);
      expect(exp.length, name).toBeGreaterThan(0);
      for (const p of res.slices.PL) {
        const rev = res.lines.filter((l) => l.cls === "revenue" && !l.excluded && !l.system).reduce((s, l) => s + (l.values[p] ?? 0), 0);
        const cost = res.lines.filter((l) => l.cls && EXPENSE_CLASSES.has(l.cls) && !l.excluded && !l.system).reduce((s, l) => s + (l.values[p] ?? 0), 0);
        expect(Math.round(sum(sales, p) - rev), `${name} sales ${p}`).toBe(0);
        expect(Math.round(sum(exp, p) - cost), `${name} costs ${p}`).toBe(0);
      }
    }
  });
});

describe("a PDF sales page becomes sales lines", () => {
  it("products by month, read from the page, go to the sales reader", async () => {
    const { tableGrid } = await import("@/lib/ingest/pdf");
    const row = (code: string, label: string, values: (number | null)[], total = false) => ({ code, label, values, total, heading: false, unclear: false });
    const g = tableGrid([{ file: "sales.pdf", n: 1, read: { kind: "sales", title: "Sales by product", company: "", currency: "EGP", scale: "units", dateText: "", columns: ["Jan 2026", "Feb 2026"], rows: [row("P1", "Oxygen Concentrator", [21000, 34000]), row("", "Full Face Mask", [2600, 5200]), row("", "Total", [23600, 39200], true)] } }]);
    const r = readSalesGrid(g)!;
    expect(r.layout.kind).toBe("pivot");
    expect(r.lines.map((l) => [l.period, l.product, l.category, l.amount])).toEqual([
      ["2026-01", "Oxygen Concentrator", "P1", 21000], ["2026-02", "Oxygen Concentrator", "P1", 34000],
      ["2026-01", "Full Face Mask", "No category", 2600], ["2026-02", "Full Face Mask", "No category", 5200],
    ]);
  });
});

describe("only vendor bills and purchase entries name a supplier", () => {
  const { COGS_SUPPLIER, CUSTOMER_DOCS } = { COGS_SUPPLIER: "Cost of goods sold (stock)", CUSTOMER_DOCS: "Customer invoices (no supplier)" };
  const ledger = [
    { code: "510000", name: "Cost of Sales", cls: "cos_variable" as const, excluded: false, entries: [
      entry("2026-10-05", "INV/2026/00412", "Vapotherm HVT 2.0", "مستشفي عين شمس التخصصي", 85000),
      entry("2026-10-06", "STJ/2026/01077", "WH/OUT/00512 - Vapotherm HVT 2.0", "مستشفى حورس التخصصي", 60000),
    ] },
    { code: "522004", name: "Penality - Late Delivery", cls: "exp_fixed" as const, excluded: false, entries: [entry("2026-10-07", "INV2/2026/0009", "Late delivery penalty", "مستشفي الكرنك الدولي", 4000)] },
    { code: "522006", name: "Office Rent", cls: "exp_fixed" as const, excluded: false, entries: [entry("2026-10-01", "BILL/2026/00301", "October rent", "Regus", 27753)] },
    { code: "522001", name: "Transportations", cls: "exp_fixed" as const, excluded: false, entries: [entry("2026-10-09", "EXP/2026/00881", "Taxi", "EPX Logistics", 3500)] },
    { code: "w.2", name: "Stock Interim (Received)", cls: "other_cl" as const, excluded: false, entries: [
      entry("2026-10-03", "BILL/2026/00290", "Aerogen Solo", "Aerogen Ltd", 120000),
      entry("2026-10-03", "STJ/2026/01001", "Receipt", "Aerogen Ltd", -120000),
    ] },
    { code: "121000", name: "Customers", cls: "ar" as const, excluded: false, entries: [entry("2026-10-05", "INV/2026/00412", "", "مستشفي عين شمس التخصصي", 99000)] },
  ];
  const lines = expensesFromLedger(ledger);

  it("cost of sales on a customer invoice or a stock move is cost of goods sold, never the customer", () => {
    const cogs = lines.filter((l) => l.account.startsWith("510000"));
    expect(cogs.map((l) => l.supplier)).toEqual([COGS_SUPPLIER, COGS_SUPPLIER]);
    expect(lines.find((l) => l.account.startsWith("522004"))!.supplier).toBe(CUSTOMER_DOCS);
    expect(lines.find((l) => l.doc.startsWith("BILL/2026/00301"))!.supplier).toBe("Regus");
    expect(lines.find((l) => l.doc.startsWith("EXP/"))!.supplier).toBe("EPX Logistics");
  });

  it("a vendor bill for goods bought into stock lists its supplier, but never counts as a cost", () => {
    const stock = lines.filter((l) => l.cls === "other_cl");
    expect(stock.map((l) => [l.supplier, l.amount])).toEqual([["Aerogen Ltd", 120000]]);
    expect(lines.some((l) => l.cls === "ar")).toBe(false);
    const accts = [
      { id: "1", code: "510000", name: "Cost of Sales", cls: "cos_variable" as const, amounts: { "2026-10": 145000 } },
      { id: "2", code: "522004", name: "Penality", cls: "exp_fixed" as const, amounts: { "2026-10": 4000 } },
      { id: "3", code: "522006", name: "Office Rent", cls: "exp_fixed" as const, amounts: { "2026-10": 27753 } },
      { id: "4", code: "522001", name: "Transportations", cls: "exp_fixed" as const, amounts: { "2026-10": 3500 } },
    ];
    const a = expensesAnalysis(accts, summariseExpenses(lines), { type: "month", end: "2026-10" }, 1);
    const names = a.bySupplier.map((r) => r.name);
    expect(names).not.toContain("مستشفي عين شمس التخصصي");
    expect(names).not.toContain("مستشفى حورس التخصصي");
    expect(a.bySupplier.filter((r) => !["Cost of goods sold (stock)", "Customer invoices (no supplier)"].includes(r.name)).map((r) => r.name)).toEqual(["Aerogen Ltd", "Regus", "EPX Logistics"]);
    expect(a.bySupplier.find((r) => r.name === "Aerogen Ltd")!.stock).toBe(120000);
    expect(a.stockBought).toBe(120000);
    expect(a.total).toBe(180253);
    expect(a.lines.total).toBe(180253);
    expect(a.unreconciled).toEqual([]);
    expect(a.concentration.topName).toBe("Aerogen Ltd");
  });

  it("a partner who is also a customer is flagged, not listed as a supplier", () => {
    const withHospitalBill = [...lines, { day: "2026-10-12", period: "2026-10", doc: "BILL/2026/00305", series: "BILL", supplier: "مستشفي عين شمس التخصصي", account: "522006 Office Rent", cls: "exp_fixed" as const, category: "Office Rent", label: "", amount: 1500 }];
    const accts = [{ id: "3", code: "522006", name: "Office Rent", cls: "exp_fixed" as const, amounts: { "2026-10": 29253 } }];
    const a = expensesAnalysis(accts, summariseExpenses(withHospitalBill), { type: "month", end: "2026-10" }, 1, { customers: new Set(["مستشفي عين شمس التخصصي"]) });
    expect(a.bySupplier.map((r) => r.name)).not.toContain("مستشفي عين شمس التخصصي");
    expect(a.alsoCustomers.map((r) => [r.name, r.amount])).toEqual([["مستشفي عين شمس التخصصي", 1500]]);
    expect(a.findings.some((f) => /also a customer/.test(f.title))).toBe(true);
  });
});

describe("banks are lenders, not suppliers", () => {
  const gl = [
    { code: "550000", name: "Financing Interest", cls: "interest_expenses" as const, excluded: false, entries: [
      entry("2026-10-05", "CIB/2026/0101", "Loan interest Oct", "", 30000),
      entry("2026-10-06", "BMISR/2026/0044", "Overdraft interest", "", 5000),
      entry("2026-10-28", "MISC/2026/0090", "Interest accrual", "", 2000),
    ] },
    { code: "522015", name: "Bank Charges & Fees Exp.", cls: "exp_variable" as const, excluded: false, entries: [
      entry("2026-10-07", "CIB/2026/0102", "Transfer fees", "", 400),
      entry("2026-10-08", "AAIB/2026/0021", "Account fees", "", 100),
    ] },
    { code: "522016", name: "مصاريف بنكية", cls: "exp_variable" as const, excluded: false, entries: [entry("2026-10-09", "NBE/2026/0003", "عمولة", "", 60)] },
    // Salaries paid from the bank journal: the bank is only how they were paid.
    { code: "521100", name: "Salaries & Allowances", cls: "exp_fixed" as const, excluded: false, entries: [entry("2026-10-25", "CIB/2026/0110", "October payroll", "", 90000)] },
    { code: "522006", name: "Office Rent", cls: "exp_fixed" as const, excluded: false, entries: [entry("2026-10-02", "BILL/2026/0300", "Rent", "Nasr City Properties", 20000)] },
  ];
  const lines = expensesFromLedger(gl);
  const who = (label: string) => lines.find((l) => l.label === label)!.supplier;

  it("puts interest and bank charges on the bank, from the bank journal they were booked in", () => {
    expect(who("Loan interest Oct")).toBe("Bank: CIB");
    expect(who("Overdraft interest")).toBe("Bank: Banque Misr");
    expect(who("Transfer fees")).toBe("Bank: CIB");
    expect(who("Account fees")).toBe("Bank: AAIB");
    expect(who("عمولة")).toBe("Bank: National Bank of Egypt");
    expect(who("Interest accrual")).toBe("Bank: (not named)");
  });

  it("leaves costs that were only paid through the bank with what they are for", () => {
    expect(who("October payroll")).toBe("No supplier");
    expect(who("Rent")).toBe("Nasr City Properties");
  });

  it("lists banks apart, with interest and charges, and keeps them out of supplier rankings", () => {
    const accts: ExpenseAccount[] = gl.map((l) => ({ id: l.code, code: l.code, name: l.name, cls: l.cls, amounts: { "2026-10": l.entries.reduce((s, e) => s + e.amount, 0) } }));
    const a = expensesAnalysis(accts, summariseExpenses(lines), { type: "month", end: "2026-10" }, 1, { revenue: { "2026-10": 500000 } });
    expect(a.byLender.map((r) => [r.name, r.interest, r.fees, r.amount])).toEqual([
      ["CIB", 30000, 400, 30400], ["Banque Misr", 5000, 0, 5000], ["Bank not named", 2000, 0, 2000], ["AAIB", 0, 100, 100], ["National Bank of Egypt", 0, 60, 60],
    ]);
    expect(a.finance).toMatchObject({ interest: 37000, fees: 560, total: 37560 });
    expect(a.bySupplier.some((r) => r.key.startsWith("Bank: "))).toBe(false);
    expect(a.concentration.suppliers).toBe(1);
    expect(a.findings.find((f) => f.title.startsWith("Banks take"))).toMatchObject({ kind: "risk", title: "Banks take 7.5% of sales" });
  });

  it("groups government payments through CPS and company-card spending through VISA, apart from suppliers", () => {
    const gl2 = [
      { code: "512100", name: "Customs Duties", cls: "cos_variable" as const, excluded: false, entries: [entry("2026-10-10", "CPS/2026/0012", "Customs release", "", 8000)] },
      { code: "522030", name: "IT Subscriptions", cls: "exp_fixed" as const, excluded: false, entries: [
        entry("2026-10-11", "VISA/2026/0031", "Microsoft 365", "", 1200),
        entry("2026-10-12", "VISA/2026/0032", "Zoom", "Zoom Video", 300),
      ] },
      { code: "522015", name: "Bank Charges & Fees Exp.", cls: "exp_variable" as const, excluded: false, entries: [
        entry("2026-10-13", "CPS/2026/0013", "Gateway fee", "", 25),
        entry("2026-10-14", "VISA/2026/0033", "Card fee", "", 50),
      ] },
    ];
    const l2 = expensesFromLedger(gl2);
    const by = (label: string) => l2.find((l) => l.label === label)!.supplier;
    expect(by("Customs release")).toBe("Government payments (CPS)");
    expect(by("Microsoft 365")).toBe("Company card spending (VISA)");
    expect(by("Zoom")).toBe("Zoom Video");
    expect(by("Gateway fee")).toBe("Bank: CPS (government payments)");
    expect(by("Card fee")).toBe("Bank: Company cards (VISA)");
    const accts: ExpenseAccount[] = gl2.map((l) => ({ id: l.code, code: l.code, name: l.name, cls: l.cls, amounts: { "2026-10": l.entries.reduce((s, e) => s + e.amount, 0) } }));
    const a = expensesAnalysis(accts, summariseExpenses(l2), { type: "month", end: "2026-10" }, 1, { revenue: { "2026-10": 500000 } });
    // Only Zoom is a supplier; the government and the card are not ranked as suppliers.
    expect(a.concentration.suppliers).toBe(1);
    expect(a.byLender.map((r) => r.name).sort()).toEqual(["CPS (government payments)", "Company cards (VISA)"]);
  });

  it("the demo company pays its loan interest and bank charges to CIB", () => {
    const accts = spreadAccounts(sample.months as MonthData[]).filter((x) => ["740100", "610300"].includes(x.code)) as ExpenseAccount[];
    const a = expensesAnalysis(accts, demoExpenses(), { type: "month", end: "2026-09" }, 1);
    expect(a.byLender[0].name).toBe("CIB");
    expect(a.byLender[0].interest).toBeGreaterThan(0);
  });
});
