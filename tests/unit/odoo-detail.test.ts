// The detail a live sync reads besides the balances, mapped to the same records the uploads store: sales lines by
// product (credit notes negative, free lines kept), stock moves with their kind, valuation records in the month of their
// journal entry, and stock on hand.
import { describe, expect, it } from "vitest";
import { OdooClient } from "@/lib/odoo/client";
import { countPart, firstStockDay, layersPage, movesPage, onHand, readLocations, salesPage, type DetailCtx } from "@/lib/odoo/detail";
import { fakeOdoo } from "../fixtures/fake-odoo";

const ctx = (v: 15 | 17 | 18 = 18): DetailCtx => ({ client: new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", fakeOdoo(v).fetch), companyId: 1, major: v, includeBranches: false });
const RANGE = { from: "2021-07-01", to: "2026-10-31" };

describe("sales lines by product", () => {
  it("an invoice, a free line and a credit note, as the Invoice Analysis upload reads them", async () => {
    const lines = await salesPage(ctx(), RANGE, 0);
    expect(lines).toEqual([
      { day: "2026-09-03", period: "2026-09", doc: "INV/2026/00001", series: "INV", customer: "Northside Hospital", product: "Oxygen Concentrator", category: "All / Devices", salesperson: "Sara Sales", qty: 2, amount: 50000, cost: null },
      { day: "2026-09-03", period: "2026-09", doc: "INV/2026/00001", series: "INV", customer: "Northside Hospital", product: "Nasal Cannula", category: "All / Consumables", salesperson: "Sara Sales", qty: 10, amount: 0, cost: null },
      { day: "2026-09-20", period: "2026-09", doc: "RINV/2026/00001", series: "RINV", customer: "Northside Hospital", product: "Oxygen Concentrator", category: "All / Devices", salesperson: "Sara Sales", qty: -1, amount: -25000, cost: null },
    ]);
    expect(await countPart(ctx(), "sales", RANGE)).toBe(3);
  });
  it("Odoo 15 marks invoice lines another way", async () => {
    expect((await salesPage(ctx(15), RANGE, 0)).length).toBe(3);
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
