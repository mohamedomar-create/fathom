import { describe, expect, it } from "vitest";
import { readWorkbook } from "@/lib/ingest/read";
import { readSalesGrid } from "@/lib/ingest/sales";
import { readExpenseGrid } from "@/lib/ingest/expenses";
import { simpleSummary } from "@/lib/engine/simple";
import { simpleBook, simpleCsv, type FixtureName } from "../fixtures/simple";

const simple = { simple: true } as const;
async function read(name: FixtureName) {
  const [s, e] = await readWorkbook(simpleBook(name), `${name}.xlsx`);
  return { sales: readSalesGrid(s, {}, simple)!, expenses: readExpenseGrid(e, {}, simple)! };
}
async function readCsv(name: FixtureName) {
  const enc = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer;
  const [s] = await readWorkbook(enc(simpleCsv(name, "sales")), "sales.csv");
  const [e] = await readWorkbook(enc(simpleCsv(name, "expenses")), "expenses.csv");
  return { sales: readSalesGrid(s, {}, simple)!, expenses: readExpenseGrid(e, {}, simple)! };
}
const total = (ls: { amount: number }[]) => Math.round(ls.reduce((s, l) => s + l.amount, 0) * 100) / 100;

describe("Simple fixtures: every row read or its reason given", () => {
  it("clean: four sales, four expenses, every column", async () => {
    const r = await read("clean");
    expect(r.sales.lines).toHaveLength(4);
    expect(total(r.sales.lines)).toBe(5000);
    expect(r.sales.lines.map((l) => [l.day, l.customer, l.cost, l.channel, l.paid, l.paidOn])[1]).toEqual(["2026-01-20", "Delta Stores", 200, "Online", false, null]);
    expect(r.expenses.lines.map((l) => [l.category, l.cls, l.amount, l.paid])).toEqual([["Rent", "exp_fixed", 1200, true], ["Advertising", "exp_variable", 300, false], ["Rent", "exp_fixed", 1200, true], ["Rent", "exp_fixed", 1200, true]]);
  });
  it("messy: title, headings on row 4, text numbers, mixed dates, blank and total rows; the bad date is named", async () => {
    const r = await read("messy");
    expect(r.sales.lines.map((l) => [l.day, l.amount])).toEqual([["2026-01-25", 1234.5], ["2026-02-07", 800], ["2026-03-12", 465.5]]);
    expect(r.sales.layout.errors).toHaveLength(1);
    expect(r.sales.layout.errors[0].message).toContain("is not a date");
    expect(r.sales.layout.trace.filter(Boolean).some((t) => t!.role === "total")).toBe(true);
    expect(r.expenses.lines.map((l) => [l.day, l.category, l.amount])).toEqual([["2026-01-25", "Rent", 1200], ["2026-02-26", "Electricity", 350.75]]);
  });
  it("minimal columns are enough", async () => {
    const r = await read("minimal");
    expect(r.sales.lines.map((l) => l.amount)).toEqual([900, 1100]);
    expect(r.expenses.lines.map((l) => [l.category, l.amount])).toEqual([["Rent", 700], ["Rent", 700]]);
  });
  it("Arabic headings and values", async () => {
    const r = await read("arabic");
    expect(r.sales.lines.map((l) => [l.customer, l.amount, l.channel, l.paid, l.paidOn])).toEqual([["شركة النيل", 1200, "متجر", true, "2026-01-20"], ["شركة الدلتا", 800, "أونلاين", false, null]]);
    expect(r.expenses.lines.map((l) => [l.category, l.cls, l.paid])).toEqual([["إيجار", "exp_fixed", true], ["دعاية", "exp_variable", false]]);
  });
  it.each(["clean", "messy", "minimal", "arabic"] as const)("%s as CSV reads the same lines as the workbook", async (name) => {
    const x = await read(name), c = await readCsv(name);
    const key = (ls: { day: string | null; amount: number }[]) => ls.map((l) => `${l.day}:${l.amount}`);
    expect(key(c.sales.lines)).toEqual(key(x.sales.lines));
    expect(key(c.expenses.lines)).toEqual(key(x.expenses.lines));
  });
});

describe("Simple fixtures through the engine (hand-checked)", () => {
  it("clean: net profit −900, gross margin 60%, receivables 500, payables 300, Nile 60%", async () => {
    const r = await read("clean");
    const s = simpleSummary({ sales: r.sales.lines, expenses: r.expenses.lines, openingCash: { amount: 10000, asOf: "2025-12-31" }, asOf: "2026-04-15" });
    expect(s.pl.total.revenue).toBe(5000);
    expect(s.pl.total.net_income).toBe(-900);
    expect(s.pl.grossMargin).toEqual({ ok: true, value: 60 });
    expect(s.receivables).toMatchObject({ ok: true, value: { total: 500 } });
    expect(s.payables).toMatchObject({ ok: true, value: { total: 300 } });
    expect(s.concentration).toMatchObject({ ok: true, value: { top1: { name: "Nile Traders", share: 60 } } });
    // Cash: in 1,000 + 2,000 + 1,500; out 1,200 × 3. 10,000 + 4,500 − 3,600 = 10,900.
    expect(s.cash.balance).toEqual({ ok: true, value: 10900 });
  });
  it("minimal: the figures that need more data say so", async () => {
    const r = await read("minimal");
    const s = simpleSummary({ sales: r.sales.lines, expenses: r.expenses.lines, openingCash: null, asOf: "2026-04-15" });
    expect(s.pl.total.net_income).toBe(600);
    expect(s.pl.grossMargin).toMatchObject({ ok: false, needs: "cost_column" });
    expect(s.concentration).toEqual({ ok: false, needs: "customers" });
    expect(s.receivables).toEqual({ ok: false, needs: "paid_column" });
    expect(s.cash.balance).toEqual({ ok: false, needs: "opening_cash" });
    expect(s.seasonality).toEqual({ ok: false, needs: "twelve_months" });
    expect(s.cash.assumedPaid.lines).toBe(4);
  });
});
