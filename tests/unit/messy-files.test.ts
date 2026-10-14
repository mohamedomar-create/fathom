import { describe, expect, it } from "vitest";
import { readWorkbooks } from "@/lib/ingest/read";
import { cashAccounts, ownerNetFormula, readCashBook } from "@/lib/ingest/cashbook";
import { tieMessages, workbookTie } from "@/lib/ingest/workbook";
import { readBankStatement } from "@/lib/ingest/bank";
import { guessRoles, needsConfirm } from "@/lib/ingest/roles";
import { sumTerms } from "@/lib/ingest/formula";
import { monthHeading } from "@/lib/ingest/parse";
import { bankCells, bookOf, cashBookCells, journalCells, priceListCells, quarterCells, summaryCells, yearSummaryCells } from "../fixtures/messy";

const read = async (sheets: Parameters<typeof bookOf>[0]) => readWorkbooks([{ name: "messy.xlsx", data: bookOf(sheets) }]);
const sum = (ls: { amount: number }[]) => Math.round(ls.reduce((a, l) => a + l.amount, 0) * 100) / 100;
const by = <T extends { amount: number }>(ls: T[], k: (l: T) => string) => { const m: Record<string, number> = {}; for (const l of ls) m[k(l)] = (m[k(l)] ?? 0) + l.amount; return m; };

describe("reading a messy workbook", () => {
  it("cuts cells far from the table, keeps formulas, and keeps spreadsheet errors visible", async () => {
    const [cash, price] = await read({ "Q1 cash": cashBookCells(), Prices: priceListCells() });
    expect(Math.max(...cash.rows.map((r) => r?.length ?? 0))).toBe(13);
    expect(cash.cut).toEqual([expect.objectContaining({ what: "columns", from: "AO", cells: 40, rows: [6] })]);
    expect(cash.formulas?.["14:1"]).toBe("SUM(B4:B13)");
    expect(price.broken).toBe(1);
    expect(price.rows[4][4]).toBe("#REF!");
  });

  it("understands the sums people write, and month headings", () => {
    expect(sumTerms("SUM(L21:L82)")).toEqual([{ sign: 1, r0: 20, c0: 11, r1: 81, c1: 11 }]);
    expect(sumTerms("=B24+B46-$B$69")?.map((t) => [t.sign, t.r0])).toEqual([[1, 23], [1, 45], [-1, 68]]);
    expect(sumTerms("SUM(M29:M45)+M11")).toHaveLength(2);
    expect(sumTerms("B5*1.14")).toBeNull();
    expect(sumTerms("'Other sheet'!A1")).toBeNull();
    expect(monthHeading("DECEMBER 2024 sales")).toEqual({ month: 12, year: 2024, sales: true });
    expect(monthHeading("JANUARY")).toEqual({ month: 1, year: null, sales: false });
    expect(monthHeading("Octobre")).toEqual({ month: 10, year: null, sales: false });
    expect(monthHeading("JAN 2026 sales")).toEqual({ month: 1, year: 2026, sales: true });
    expect(monthHeading("مبيعات يناير 2026")).toEqual({ month: 1, year: 2026, sales: true });
    expect(monthHeading("Packaging")).toBeNull();
    expect(monthHeading("Q1 sales")).toBeNull();
  });
});

describe("a cash book", () => {
  it("reads money out by kind of cost and money in by store, and every one of the owner's totals matches", async () => {
    const [g] = await read({ "Q1 cash": cashBookCells() });
    const r = readCashBook(g)!;
    expect(r.layout.errors).toEqual([]);
    // Money out: 8 entries, as the owner's own total F15 (43,150).
    expect(r.expenses).toHaveLength(8);
    expect(sum(r.expenses)).toBe(43150);
    expect(by(r.expenses, (l) => l.account)).toEqual({ "Fixed Cost": 10000, "Variable cost": 1650, "Production Cost": 19500, Salaries: 12000 });
    expect(by(r.expenses, (l) => l.period)).toEqual({ "2026-01": 24650, "2026-02": 18500 });
    expect(r.expenses.find((l) => l.label === "Gift boxes")).toMatchObject({ category: "Packaging", cls: "exp_variable", src: { sheet: "Q1 cash", row: 7 } });
    expect(r.expenses.find((l) => l.label === "Wood and finishing")!.cls).toBe("cos_variable");
    // Money in: "DECEMBER 2025 sales" belong to December even though the money came in January.
    expect(by(r.sales, (l) => l.period)).toEqual({ "2025-12": 12500, "2026-01": 13500 });
    expect(r.sales.find((l) => l.customer === "Lotus Store" && l.period === "2025-12")!.day).toBeNull();
    // Every total the owner wrote over entries matches what was read.
    const direct = r.layout.controls.filter((c) => !c.derived);
    expect(direct.map((c) => c.formula).sort()).toEqual(["=SUM(B4:B13)", "=SUM(C4:C13)", "=SUM(D4:D13)", "=SUM(E4:E13)", "=SUM(K11:K13)", "=SUM(L4:L13)"]);
    expect(r.layout.controls.every((c) => c.ok)).toBe(true);
    // Said, not hidden: December's sales are outside the owner's sales total; the summary row is not counted.
    const checks = r.layout.checks.map((c) => c.message).join("\n");
    expect(checks).toMatch(/column K: rows 4–5 \(12,500\) are not in any of your totals/);
    expect(checks).toMatch(/row 18: "Q1 sales 26,000 43,150" is below your totals/);
    expect(r.layout.blocks.map((b) => [b.dir, b.vatMode ?? null])).toEqual([["out", null], ["in", "excluded"]]);
  });

  it("a total that does not match the entries blocks saving and names the number it did not count", async () => {
    const cells = cashBookCells();
    // The owner's total was worked out before a line was added (its saved result is stale).
    cells.C9 = 300;
    const r1 = readCashBook((await read({ Cash: cells }))[0])!;
    const c15 = r1.layout.controls.find((c) => c.formula === "=SUM(C4:C13)")!;
    expect([c15.file, c15.read, c15.ok]).toEqual([1650, 1950, false]);
    expect(r1.layout.errors.map((e) => e.message).join()).toMatch(/row 15, column C: your total 1,650 \(=SUM\(C4:C13\)\) does not match the entries iReport read from C4:C13: 1,950/);
    // A number inside the total that iReport did not count (no name, no date) is named.
    const cells2 = cashBookCells();
    // A figure with no name and no date inside the owner's SUM: the owner counts it, iReport does not.
    cells2.C7 = 300; cells2.A7 = null; cells2.C15 = { f: "SUM(C4:C13)", v: 1950 };
    const r2 = readCashBook((await read({ Cash: cells2 }))[0])!;
    expect(r2.layout.errors.map((e) => e.message).join()).toMatch(/row 7 holds a number iReport did not count/);
    expect(r2.layout.checks.map((c) => c.message).join()).toMatch(/row 7, column C: 300 has no name and no date/);
  });

  it("an unreadable amount on an entry is an error to fix, never a zero", async () => {
    const cells = cashBookCells();
    cells.D12 = { err: "#REF!" };
    const r = readCashBook((await read({ Cash: cells }))[0])!;
    expect(r.layout.errors[0].message).toBe('row 12, column D: "#REF!" is not a number');
    expect(r.expenses.some((l) => l.label === "Inlay work")).toBe(false);
  });
});

describe("a bank statement", () => {
  it("checks every balance, and counts nothing unless asked", async () => {
    const [g] = await read({ Bank: bankCells() });
    const r = readBankStatement(g)!;
    expect(r.layout.errors).toEqual([]);
    expect([r.layout.opening, r.layout.closing, r.layout.balanced]).toEqual([50000, 44149.5, 5]);
    expect([r.layout.moneyIn.total, r.layout.moneyOut.total]).toEqual([18400, 24250.5]);
    expect([r.sales.length, r.expenses.length]).toEqual([0, 0]);
    const asked = readBankStatement(g, { outAsExpenses: true })!;
    expect(sum(asked.expenses)).toBe(24250.5);
    expect(asked.expenses[0]).toMatchObject({ label: "Rent March", period: "2026-03", src: { sheet: "Bank", row: 5 } });
  });

  it("a balance that does not follow is shown at its row", async () => {
    const r = readBankStatement((await read({ Bank: bankCells(2) }))[0])!;
    expect(r.layout.errors[0].message).toMatch(/^row 7, column E: the balance 52,849.5 does not follow from the line before: 54,000 − 1,250.5 out = 52,749.5/);
  });

  it("works newest first too", async () => {
    const cells = bankCells();
    const rows = [5, 6, 7, 8, 9].map((r) => ["A", "B", "C", "D", "E"].map((c) => cells[`${c}${r}`]));
    rows.reverse().forEach((row, i) => ["A", "B", "C", "D", "E"].forEach((c, j) => { cells[`${c}${5 + i}`] = row[j] ?? null; }));
    delete cells.B4; delete cells.E4;
    const r = readBankStatement((await read({ Bank: cells }))[0])!;
    expect(r.layout.newestFirst).toBe(true);
    expect(r.layout.errors).toEqual([]);
    expect(r.layout.balanced).toBe(5);
  });
});

describe("what each sheet is", () => {
  it("guesses, says why, and asks the person to confirm when figures are left out or a new kind of reading is used", async () => {
    const grids = await read({ "Q1 cash": cashBookCells(), Bank: bankCells(), Prices: priceListCells(), Valuation: summaryCells(), Journal: journalCells(), Notes: { A1: "Read me", A2: "Totals are in EGP" } });
    const gs = guessRoles(grids);
    expect(gs.map((g) => [g.sheet, g.role, g.sure])).toEqual([
      ["Q1 cash", "cashbook", true], ["Bank", "bank", true], ["Prices", "pricelist", true], ["Valuation", "summary", false], ["Journal", "statement", true], ["Notes", "notes", true],
    ]);
    expect(gs[0].why).toMatch(/money out in 4 columns and money in/);
    expect(gs[0].notes[0]).toMatch(/40 cells far to the right of the table \(columns AO–/);
    expect(gs[2].notes).toEqual(["1 cell shows a spreadsheet error (#REF!, #DIV/0!…)."]);
    expect(needsConfirm(gs, {})).toBe(true);
    // A plain statement upload needs no extra step.
    expect(needsConfirm(gs.filter((g) => g.sheet === "Journal" || g.sheet === "Notes"), {})).toBe(false);
  });
});

describe("a workbook of many tabs", () => {
  const readAll = async (sheets: Parameters<typeof bookOf>[0]) => {
    const grids = await read(sheets);
    const roles = guessRoles(grids);
    const cash = grids.filter((g) => roles.find((r) => r.sheet === g.name)?.role === "cashbook");
    const ownerNet = cash.some((g) => !!ownerNetFormula(g));
    const books = cash.map((g) => readCashBook(g, { ownerNet })!);
    const sales = books.flatMap((b) => b.sales), expenses = books.flatMap((b) => b.expenses);
    const tie = workbookTie({ grids, layouts: books.map((b) => b.layout), sales, expenses, summarySheets: new Set(roles.filter((r) => ["cashbook", "summary", "notes"].includes(r.role)).map((r) => r.sheet)) });
    return { roles, books, sales, expenses, tie };
  };

  it("follows the owner's own rules (net of VAT by their formula, months by their headings) and matches their summary tab", async () => {
    const { roles, sales, expenses, tie, books } = await readAll({ "Q1 2026": quarterCells(1), "Q2 2026": quarterCells(2), Summary: yearSummaryCells() });
    expect(roles.map((r) => r.role)).toEqual(["cashbook", "cashbook", "summary"]);
    expect(books.every((b) => b.layout.errors.length === 0 && b.layout.controls.every((c) => c.ok))).toBe(true);
    expect(books[0].layout.blocks.find((b) => b.dir === "in")!.vatMode).toBe("owner-net");
    // Sales = EGP − VAT, as the owner's K15 = K14 − L14.
    expect(by(sales, (l) => l.period)).toEqual({ "2026-01": 12500, "2026-02": 11180, "2026-03": 1500, "2026-04": 12500, "2026-05": 11180, "2026-06": 1500 });
    // The payment dated 30 December sits under JANUARY: it counts in January, as the owner grouped it.
    expect(by(expenses, (l) => l.period)).toEqual({ "2026-01": 17450, "2026-02": 11000, "2026-03": 12500, "2026-04": 17450, "2026-05": 11000, "2026-06": 12500 });
    expect(expenses.find((l) => l.label === "Wood and finishing" && l.period === "2026-01")!.day).toBeNull();
    // Every figure of the owner's summary tab matches (the Q3 target has no Q3 entries to compare with, so it is not checked).
    expect(tie.rows.map((r) => [r.label, r.status])).toEqual([
      ["Q1 sales", "ok"], ["Q1 expenses", "ok"], ["Q2 sales", "ok"], ["Q2 expenses", "ok"], ["Total sales 2026", "ok"], ["Total expenses 2026", "ok"], ["Profit 2026", "ok"],
    ]);
    expect(tieMessages(tie).filter((m) => m.severity === "error")).toEqual([]);
    // The P&L built from the same lines: revenue and each cost column by month.
    const accts = cashAccounts(sales, expenses, { Salaries: "exp_fixed" });
    const total = (a: (typeof accts)[number]) => Object.values(a.amounts).reduce((x, y) => x + y, 0);
    expect(Object.fromEntries(accts.map((a) => [a.name, [a.cls, total(a)]]))).toEqual({
      "Sales (cash book)": ["revenue", 50360], "Fixed Cost": ["exp_fixed", 30000], "Production Cost": ["cos_variable", 39000], "Variable cost": ["exp_variable", 900], Salaries: ["exp_fixed", 12000],
    });
    expect(accts[0].amounts).toEqual({ "2026-01": 12500, "2026-02": 11180, "2026-03": 1500, "2026-04": 12500, "2026-05": 11180, "2026-06": 1500 });
  });

  it("a summary figure that differs inside the owner's table blocks saving; a copied tab is caught", async () => {
    const { tie } = await readAll({ "Q1 2026": quarterCells(1), "Q2 2026": quarterCells(2), Summary: yearSummaryCells(25000) });
    const errors = tieMessages(tie).filter((m) => m.severity === "error").map((m) => m.message);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^Summary, row 4, column B: your "Q2 sales" says 25,000; the entries iReport read for Q2 2026 come to 25,180 \(\+180\)/);
    const copy = await readAll({ "Q1 2026": quarterCells(1), "Q1 2026 (2)": quarterCells(1) });
    expect(copy.tie.duplicates).toEqual([expect.objectContaining({ a: "Q1 2026", b: "Q1 2026 (2)", share: 1 })]);
    expect(tieMessages(copy.tie).find((m) => m.severity === "error")!.message).toMatch(/One looks like a copy of the other/);
  });
});
