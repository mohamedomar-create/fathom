// The detail a live sync reads besides the balances, mapped to the same records the uploads store: sales lines by
// product (credit notes negative, free lines kept), stock moves with their kind, valuation records in the month of their
// journal entry, and stock on hand.
import { describe, expect, it } from "vitest";
import { OdooClient } from "@/lib/odoo/client";
import { countPart, firstStockDay, layersPage, movesPage, onHand, readLocations, salesPage, type DetailCtx } from "@/lib/odoo/detail";
import { fakeOdoo } from "../fixtures/fake-odoo";

const ctx = (v: 15 | 17 | 18 = 18, opts: Parameters<typeof fakeOdoo>[1] = {}): DetailCtx => ({ client: new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", fakeOdoo(v, opts).fetch), companyId: 1, major: v, includeBranches: false });
const RANGE = { from: "2021-07-01", to: "2026-10-31" };

describe("sales lines by product", () => {
  it("an invoice, a free line and a credit note, as the Invoice Analysis upload reads them", async () => {
    const lines = await salesPage(ctx(), RANGE, 0);
    expect(lines).toEqual([
      { day: "2026-09-03", period: "2026-09", doc: "INV/2026/00001", series: "INV", customer: "Northside Hospital", product: "Oxygen Concentrator", category: "All / Devices", salesperson: "Sara Sales", qty: 2, amount: 50000, cost: null, note: "x" },
      { day: "2026-09-03", period: "2026-09", doc: "INV/2026/00001", series: "INV", customer: "Northside Hospital", product: "Nasal Cannula", category: "All / Consumables", salesperson: "Sara Sales", qty: 10, amount: 0, cost: null, note: "free" },
      { day: "2026-09-20", period: "2026-09", doc: "RINV/2026/00001", series: "RINV", customer: "Northside Hospital", product: "Oxygen Concentrator", category: "All / Devices", salesperson: "Sara Sales", qty: -1, amount: -25000, cost: null, note: "return" },
    ]);
    expect(await countPart(ctx(), "sales", RANGE)).toBe(3);
  });
  it("Odoo 15 marks invoice lines another way", async () => {
    expect((await salesPage(ctx(15), RANGE, 0)).length).toBe(3);
  });
});

describe("the end user behind agency sales (exact links only)", () => {
  const pick = (l: Awaited<ReturnType<typeof salesPage>>[number]) => [l.doc, l.customer, l.saleOrder ?? "", l.endUser ?? "", l.mapMethod ?? "", l.note ?? ""];
  it("order line link, the invoice's order number, its addressed contact, its delivery address; an unlinked line keeps its description", async () => {
    const lines = (await salesPage(ctx(18, { agency: true }), RANGE, 0)).filter((l) => l.customer.startsWith("الهيئة"));
    expect(lines.map(pick)).toEqual([
      ["INV2/2026/0901", "الهيئة المصرية للشراء الموحد", "S00010", "مستشفى النور التخصصي-الشراء الموحد", "order", ""],
      ["INV2/2026/0902", "الهيئة المصرية للشراء الموحد", "S00011", "مستشفى الشفاء العام", "order", ""],
      ["INV/2026/0100", "الهيئة المصرية للشراء الموحد", "", "الهيئة المصرية للشراء الموحد (جامعه الربيع)", "contact", ""],
      ["INV/2026/0101", "الهيئة المصرية للشراء الموحد", "", "", "", "( PRO 501 / 22 ) - [Device] Airtech AE-8"],
      ["INV/2026/0102", "الهيئة المصرية للشراء الموحد", "", "مستشفى الرحمة المركزي-الشراء الموحد", "shipping", ""],
    ]);
  });
  it("a line with no order, contact or delivery link carries no end user", async () => {
    const own = (await salesPage(ctx(18, { agency: true }), RANGE, 0)).filter((l) => l.customer === "Northside Hospital");
    expect(own.every((l) => !l.endUser && !l.mapMethod)).toBe(true);
  });
  it("an Odoo without the Sales app still syncs its invoice lines (no order link to follow)", async () => {
    const lines = await salesPage(ctx(18, { agency: true, noSale: true }), RANGE, 0);
    expect(lines.length).toBe(8);
    expect(lines.find((l) => l.doc === "INV2/2026/0901")?.mapMethod ?? "").toBe("");
  });
});

describe("stock", () => {
  it("locations carry Odoo's usage as the company's location types", async () => {
    const loc = await readLocations(ctx());
    expect(loc.types).toMatchObject({ "WH/Stock": "internal", "Repair & Maintenance": "outside" });
  });

  it("moves get their kind from where the goods went (a repair location outside stock is an adjustment)", async () => {
    const c = ctx();
    const moves = await movesPage(c, RANGE.to, 0, await readLocations(c), null);
    expect(moves.map((m) => [m.odoo_key, m.kind, m.day, m.code, m.product, m.qty, m.partner])).toEqual([
      ["201", "receipt", "2026-08-10", "P1", "Oxygen Concentrator", 5, "Medline Supply"],
      ["202", "delivery", "2026-09-03", "P1", "Oxygen Concentrator", 2, "Northside Hospital"],
      ["203", "adjustment", "2026-09-25", "P2", "Nasal Cannula", 3, ""],
    ]);
  });

  it("Odoo 15/16 count done quantity in qty_done", async () => {
    const c = ctx(15);
    expect((await movesPage(c, RANGE.to, 0, await readLocations(c), null)).map((m) => m.qty)).toEqual([5, 2, 3]);
  });

  it("valuation records: the month of their journal entry, the kind of their move, landed costs named", async () => {
    const c = ctx();
    const layers = await layersPage(c, RANGE.to, 0, await readLocations(c), null);
    expect(layers.map((l) => [l.odoo_key, l.day, l.kind, l.value, l.category, l.landed_ref])).toEqual([
      ["401", "2026-08-31", "receipt", 50000, "All / Devices", ""],
      ["402", "2026-09-03", "delivery", -20000, "All / Devices", ""],
      ["403", "2026-09-10", "landed_cost", 1500, "All / Devices", "LC/2026/0001"],
    ]);
  });

  it("stock on hand in the company's own locations, and the first stock day for the months to cover", async () => {
    const c = ctx();
    expect(await onHand(c, await readLocations(c))).toEqual([{ product: "Oxygen Concentrator", code: "P1", location: "WH/Stock", lot: "", qty: 3, value: 31500 }]);
    expect(await firstStockDay(c)).toBe("2026-08-10");
  });
});

describe("journal lines, page by page (the first step of the stage)", async () => {
  const { syncOdoo, syncLedgerLines } = await import("@/lib/odoo/sync");
  const { ledgerPage, countLedger } = await import("@/lib/odoo/detail");
  it("pages of revenue, cost and stock lines give the same sales, expense and stock lines as the one-request sync", async () => {
    const client = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", fakeOdoo(17).fetch);
    const opts = { companyId: 1, includeBranches: false, months: 25, end: "2026-09" };
    const res = await syncOdoo(client, opts);
    const whole = await syncLedgerLines(client, opts, res);
    const accts = res.accounts.filter((a) => a.odoo_id !== null).map((a) => ({ odoo_id: a.odoo_id!, code: a.code, name: a.name, cls: a.cls }));
    const range = { from: `${res.periods[0]}-01`, to: "2026-09-30" };
    const c: DetailCtx = { client, companyId: 1, major: 17, includeBranches: false };
    const total = await countLedger(c, accts, range);
    const got = { sales: [] as unknown[], expenses: [] as unknown[], stock: [] as unknown[] };
    for (let offset = 0; offset < total; offset += 7) {
      const p = await ledgerPage(c, accts, range, offset, 7);
      got.sales.push(...p.sales); got.expenses.push(...p.expenses); got.stock.push(...p.stock);
    }
    const sum = (ls: unknown[]) => Math.round((ls as { amount: number }[]).reduce((s, l) => s + l.amount, 0));
    expect(got.sales.length).toBe(whole.sales.length);
    expect(got.expenses.length).toBe(whole.expenses.length);
    expect([sum(got.sales), sum(got.expenses)]).toEqual([sum(whole.sales), sum(whole.expenses)]);
  });
});

describe("D9: the sync takes supplier bills on stock accounts as purchases, like the upload", async () => {
  const { ledgerAccounts, linesFromEntries } = await import("@/lib/odoo/detail");
  const { expensesFromLedger } = await import("@/lib/ingest/expenses");
  const accts = [
    { odoo_id: 1, code: "4000", name: "Sales", cls: "revenue" as const },
    { odoo_id: 2, code: "1200", name: "Inventory", cls: "inventory" as const },
    { odoo_id: 3, code: "2105", name: "Stock Interim (Received)", cls: "other_cl" as const },
    { odoo_id: 4, code: "2100", name: "Suppliers", cls: "ap" as const },
    { odoo_id: 5, code: "5100", name: "Freight", cls: "exp_variable" as const },
  ];
  const e = (ref: string, partner: string, amount: number) => ({ day: "2026-09-10", period: "2026-09", ref, label: "", partner, amount });
  const entries = new Map([[2, [e("BILL/2026/0001", "Medline", 500)]], [3, [e("BILL/2026/0002", "Swift", 300), e("STJ/2026/0009", "", -300)]], [5, [e("BILL/2026/0003", "DHL", 40)]]]);
  it("reads the stock interim account, never the payables account", () => {
    expect(ledgerAccounts(accts).map((a) => a.code)).toEqual(["4000", "1200", "2105", "5100"]);
  });
  it("gives the same expense lines as the upload's reader for the same entries", () => {
    const got = linesFromEntries(ledgerAccounts(accts), entries);
    const upload = expensesFromLedger(accts.map((a) => ({ code: a.code, name: a.name, cls: a.cls, excluded: false, entries: entries.get(a.odoo_id) ?? [] })));
    expect(got.expenses).toEqual(upload);
    expect(got.expenses.map((l) => [l.supplier, l.amount])).toEqual([["Medline", 500], ["Swift", 300], ["DHL", 40]]);
  });
});
