import { describe, expect, it } from "vitest";
import sample from "../../reference/sample.json";
import { salesAnalysis, summariseSales } from "@/lib/engine";
import { readSalesGrid, salesFromLedger, seriesOf, splitLabel } from "@/lib/ingest/sales";
import { demoSales } from "@/lib/company/demo-sales";
import { parseSalesSummary } from "@/lib/company/sales-parse";

type L = Parameters<typeof summariseSales>[0][number];
const line = (p: Partial<L> & { period: string; amount: number }): L => ({ doc: "", series: "INV", customer: "A", product: "P1", category: "C1", salesperson: "", qty: null, cost: null, ...p });

describe("reading sales from an Odoo General Ledger", () => {
  it("splits Odoo's invoice line label into category and product", () => {
    expect(splitLabel("[Trudell] Aero Chamber Plus, Medium Mask")).toEqual({ category: "Trudell", product: "Aero Chamber Plus, Medium Mask" });
    expect(splitLabel("[Device] Airtech AE-8 10L/min\n01/04/2026 13:00:00 to 02/04/2026 13:00:00")).toEqual({ category: "Device", product: "Airtech AE-8 10L/min" });
    expect(splitLabel("Consulting fee")).toEqual({ category: "No category", product: "Consulting fee" });
    expect(seriesOf("INV2/2026/0004")).toBe("INV2");
    expect(seriesOf("RINV/2026/0001")).toBe("RINV");
  });

  it("turns revenue-account entries into sales lines with the credit as a positive amount", () => {
    const lines = salesFromLedger([
      { cls: "revenue", excluded: false, entries: [
        { day: "2026-01-04", period: "2026-01", ref: "INV/2026/0004", label: "[Trudell] Aero Bika", partner: "Rasha", amount: -6500 },
        { day: "2026-01-20", period: "2026-01", ref: "RINV/2026/0001", label: "[Trudell] Aero Bika", partner: "Rasha", amount: 500 },
      ] },
      { cls: "revenue", excluded: false, entries: [{ day: "2026-01-31", period: "2026-01", ref: "MISC/2026/0001", label: "Entry MISC/2026/0001", partner: "", amount: -1000 }] },
      { cls: "cos_variable", excluded: false, entries: [{ day: "2026-01-04", period: "2026-01", ref: "STJ/1", label: "x", partner: "", amount: 4000 }] },
      { cls: "revenue", excluded: true, entries: [{ day: "2026-01-04", period: "2026-01", ref: "INV/2026/0009", label: "x", partner: "", amount: -99 }] },
    ]);
    expect(lines.map((l) => [l.doc, l.series, l.customer, l.category, l.product, l.amount])).toEqual([
      ["INV/2026/0004", "INV", "Rasha", "Trudell", "Aero Bika", 6500],
      ["RINV/2026/0001", "RINV", "Rasha", "Trudell", "Aero Bika", -500],
      ["MISC/2026/0001", "MISC", "No customer", "No category", "Revenue journal entries (no invoice)", 1000],
    ]);
  });
});

describe("reading a sales export", () => {
  it("an Odoo Invoice Analysis list, untaxed amounts preferred, cost from margin", () => {
    const r = readSalesGrid({ name: "Invoice Analysis", rows: [
      ["Invoice Date", "Number", "Partner", "Product", "Product Category", "Salesperson", "Quantity", "Untaxed Total", "Total", "Margin"],
      ["15/01/2026", "INV/2026/0001", "Clinic A", "[Dev] Concentrator", "Devices", "Sara", 2, 20000, 22800, 7000],
      ["03/02/2026", "INV/2026/0002", "Clinic B", "Mask", "Consumables", "Omar", 10, 2600, 2964, 1100],
      ["Total", null, null, null, null, null, 12, 22600, 25764, 8100],
    ] });
    expect(r?.layout.kind).toBe("list");
    expect(r?.layout.taxIncluded).toBe(false);
    expect(r?.lines).toEqual([
      { day: "2026-01-15", period: "2026-01", doc: "INV/2026/0001", series: "INV", customer: "Clinic A", product: "Concentrator", category: "Devices", salesperson: "Sara", qty: 2, amount: 20000, cost: 13000 },
      { day: "2026-02-03", period: "2026-02", doc: "INV/2026/0002", series: "INV", customer: "Clinic B", product: "Mask", category: "Consumables", salesperson: "Omar", qty: 10, amount: 2600, cost: 1500 },
    ]);
  });

  it("an Arabic list with only a tax-inclusive total says so", () => {
    const r = readSalesGrid({ name: "مبيعات", rows: [["التاريخ", "العميل", "الصنف", "الكمية", "الإجمالي"], ["2026-03-01", "عميل ١", "جهاز", "١", "١٬١٤٠"]] });
    expect(r?.lines[0]).toMatchObject({ period: "2026-03", customer: "عميل ١", product: "جهاز", qty: 1, amount: 1140 });
    expect(r?.layout.taxIncluded).toBe(true);
  });

  it("a pivot of categories by month, skipping totals", () => {
    const r = readSalesGrid({ name: "Pivot", rows: [
      ["", "January 2026", "February 2026", "Total"],
      ["", "Untaxed Total", "Untaxed Total", "Untaxed Total"],
      ["Devices", 50000, 60000, 110000],
      ["Consumables", 8000, 7000, 15000],
      ["Total", 58000, 67000, 125000],
    ] });
    expect(r?.layout).toMatchObject({ kind: "pivot", rowsAre: "product", measure: "untaxed", taxIncluded: false, total: 125000 });
    expect(r?.lines).toHaveLength(4);
  });

  it("accounting reports are left to the accounting reader", () => {
    expect(readSalesGrid({ name: "TB", rows: [["Code", "Account Name", "Debit", "Credit"], ["4000", "Sales", 0, 100]] })).toBeNull();
    // A P&L with month columns and an empty corner cell is not a sales pivot.
    expect(readSalesGrid({ name: "P&L", rows: [["", "Jan 2026", "Feb 2026"], ["Revenue", 100, 120], ["Cost of sales", 60, 70]] })).toBeNull();
  });
});

describe("sales analysis, worked by hand", () => {
  // Jan: A buys 100 (2 × P1 at 50), B buys 60 (3 × P2 at 20); Feb: A buys 120 (2 × P1 at 60) and 40 (2 × P2 at 20), C buys 30 (1 × P3).
  const data = summariseSales([
    line({ period: "2026-01", doc: "I1", customer: "A", product: "P1", qty: 2, amount: 100, cost: 60 }),
    line({ period: "2026-01", doc: "I2", customer: "B", product: "P2", category: "C2", qty: 3, amount: 60, cost: 30 }),
    line({ period: "2026-02", doc: "I3", customer: "A", product: "P1", qty: 2, amount: 120, cost: 60 }),
    line({ period: "2026-02", doc: "I3", customer: "A", product: "P2", category: "C2", qty: 2, amount: 40, cost: 20 }),
    line({ period: "2026-02", doc: "I4", customer: "C", product: "P3", category: "C2", qty: 1, amount: 30, cost: 10 }),
  ]);
  const s = salesAnalysis(data, { type: "month", end: "2026-02" }, 1, { revenue: { "2026-01": 160, "2026-02": 200 } });

  it("totals, invoices and growth", () => {
    expect(s.total).toBe(190);
    expect(s.compare).toBe(160);
    expect(s.growth).toBeCloseTo(18.75, 9);
    // I3 has two lines but is one invoice.
    expect(s.invoices).toBe(2);
    expect(s.avgInvoice).toBe(95);
    expect(s.margin).toBeCloseTo(((190 - 90) / 190) * 100, 9);
  });

  it("price, volume, mix and new products add up to the change exactly", () => {
    const p = s.pvm!;
    // Products in both months: P1 (2 at 50 → 2 at 60), P2 (3 at 20 → 2 at 20). Average Jan price 160 / 5 = 32.
    expect(p.price).toBeCloseTo(20, 9);
    expect(p.volume).toBeCloseTo((4 - 5) * 32, 9);
    expect(p.mix).toBeCloseTo(50 * 2 + 20 * 2 - 4 * 32, 9);
    expect(p.newLost).toBeCloseTo(30, 9);
    expect(p.price + p.volume + p.mix + p.newLost).toBeCloseTo(p.total, 9);
    expect(p.total).toBe(30);
  });

  it("categories and customers rank by sales with shares", () => {
    expect(s.byCategory.map((r) => [r.name, r.amount, r.compare])).toEqual([["C1", 120, 100], ["C2", 70, 60]]);
    expect(s.byCustomer[0]).toMatchObject({ name: "A", amount: 160, invoices: 1 });
    expect(s.customers.topShare).toBeCloseTo((160 / 190) * 100, 9);
  });

  it("reconciles to P&L revenue month by month", () => {
    expect(s.unreconciled).toEqual([{ period: "2026-02", sales: 190, revenue: 200, diff: -10 }]);
    expect(s.findings.some((f) => f.title.startsWith("Sales differ from P&L revenue"))).toBe(true);
  });

  it("new and lost customers need history, and say so", () => {
    expect(s.customers.new).toBeNull();
    expect(s.customers.lost).toBeNull();
    expect(s.notes.join(" ")).toContain("three months");
  });

  it("ABC classes: the products making the first 80% of sales are A", () => {
    // P1 120 (63%), P2 40, P3 30: P1 starts at 0% → A; P2 starts at 63% → A; P3 starts at 84% → B.
    expect(s.byProduct.map((r) => [r.name, r.abc])).toEqual([["P1", "A"], ["P2", "A"], ["P3", "B"]]);
  });
});

describe("the demo company's sales", () => {
  it("add up to its P&L revenue and variable cost of sales in every month", () => {
    const d = demoSales();
    for (const m of sample.months) {
      if (!m.pl.revenue) continue;
      const a = d.customers.filter((r) => r.p === m.period).reduce((x, r) => x + r.a, 0);
      const k = d.products.filter((r) => r.p === m.period).reduce((x, r) => x + (r.k ?? 0), 0);
      expect(a).toBeCloseTo(m.pl.revenue, 2);
      expect(k).toBeCloseTo(m.pl.cos_variable ?? 0, 2);
    }
  });

  it("the database summary is read safely", () => {
    const d = parseSalesSummary({ customers: [{ p: "2026-01", c: "A", s: "INV", sp: "", a: "100.50", k: null, ka: null, q: "2", d: 1, n: 1 }], products: [], sources: { "2026-01": "file" } });
    expect(d.customers[0]).toMatchObject({ a: 100.5, q: 2, k: null });
    expect(parseSalesSummary(null).customers).toEqual([]);
  });
});

describe("accounting files are never taken for sales exports", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { readWorkbooks } = await import("@/lib/ingest/read");
  const { corpus } = await import("../fixtures/egypt-corpus");
  const dir = path.join(__dirname, "../fixtures/files");
  const files = [
    ...corpus().map((f) => ({ name: f.name, data: f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer })),
    ...fs.readdirSync(dir).filter((f) => f.endsWith(".xlsx") && !f.includes("invoice-analysis")).map((f) => { const b = fs.readFileSync(path.join(dir, f)); return { name: f, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }; }),
  ];
  for (const f of files) {
    it(f.name, async () => {
      const grids = await readWorkbooks([f]);
      expect(grids.filter((g) => readSalesGrid(g)).map((g) => g.name)).toEqual([]);
    });
  }
});
