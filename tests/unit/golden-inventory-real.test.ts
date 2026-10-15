import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { readWorkbook } from "@/lib/ingest/read";
import { guessRole } from "@/lib/ingest/roles";
import { readInventorySheets } from "@/lib/ingest/inventory-sheets";
import { productKey } from "@/lib/ingest/inventory";
import { EMPTY_INVENTORY, inventoryAnalysis, type InventoryData } from "@/lib/engine/inventory";

// Real exports are never committed (this repository is public). Point REAL_INV_DIR at a folder holding a company's Odoo
// Stock Valuation Layer, Product Moves (Stock Move Line) and Product Variant exports to run this locally. It checks
// invariants, never a company's figures.
const dir = process.env.REAL_INV_DIR ?? "";

describe.skipIf(!dir)("real Odoo Inventory exports (local only)", () => {
  it("every sheet goes to its place, the pages add up to the valuation, and every difference names its products", async () => {
    const files = fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f));
    const grids = (await Promise.all(files.map(async (f) => {
      const b = fs.readFileSync(path.join(dir, f));
      return (await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, f)).map((g) => ({ ...g, name: f }));
    }))).flat();
    const roles = Object.fromEntries(grids.map((g) => [g.name, guessRole(g).role]));
    expect(new Set(Object.values(roles))).toEqual(new Set(["stock_valuation", "stock_moves", "stock_onhand"]));
    const parts = readInventorySheets(grids, (n) => roles[n] as never, null, "EGP")!;

    // The database summary: per month, kind and product (its reference and name).
    const lay = new Map<string, InventoryData["layers"][number]>();
    for (const l of parts.layers) {
      const k = [l.period, l.kind, l.code, l.product].join("|");
      const x = lay.get(k) ?? { p: l.period, kind: l.kind, code: l.code, product: l.product, category: "", q: 0, v: 0, n: 0 };
      x.q += l.qty; x.v += l.value; x.n++; lay.set(k, x);
    }
    const mv = new Map<string, InventoryData["moves"][number]>();
    for (const m of parts.moves) {
      const k = [m.period, m.kind, m.code, m.product, m.from, m.to].join("|");
      const x = mv.get(k) ?? { p: m.period, kind: m.kind, code: m.code, product: m.product, from: m.from, to: m.to, q: 0, n: 0 };
      x.q += m.qty; x.n++; mv.set(k, x);
    }
    const d: InventoryData = { ...EMPTY_INVENTORY, layers: [...lay.values()], moves: [...mv.values()], onhand: parts.onhand!.rows, meta: { withIds: parts.withIds, kinds: [], periods: [] } };
    const end = parts.layers.map((l) => l.period).sort().at(-1)!;
    const a = inventoryAnalysis(d, { type: "month", end }, 1, { ledger: { stock: null, cogs: null } });

    const books = parts.layers.reduce((s, l) => s + l.value, 0);
    // Products are never merged by a shared internal reference.
    expect(a.products.length).toBe(new Set(parts.layers.map((l) => productKey(l.code, l.product))).size);
    // The stock value is the valuation, and where it is adds up to it.
    expect(a.tiles.value).toBeCloseTo(books, 1);
    expect(a.position!.warehouse + a.position!.rental + a.position!.transit).toBeCloseTo(books, 0);
    // A valuation row with a move is classified by it.
    const docs = new Set(parts.moves.map((m) => `${m.ref}|${productKey(m.code, m.product)}`));
    expect(parts.layers.filter((l) => l.kind === "other" && docs.has(`${l.ref}|${productKey(l.code, l.product)}`) && parts.moves.some((m) => m.ref === l.ref && productKey(m.code, m.product) === productKey(l.code, l.product) && m.kind !== "internal" && m.kind !== "rental_out" && m.kind !== "rental_back"))).toEqual([]);
    // Rentals move goods, not value.
    expect(a.tieouts.filter((t) => t.key === "rental_value" && t.status === "off")).toEqual([]);
    // A value difference is fully explained by the products it lists.
    const v = a.tieouts.find((t) => t.key === "onhand_value")!;
    if (v.status === "off" && v.causes.length < 20) expect(v.causes.reduce((s, c) => s + c.module - c.ledger, 0)).toBeCloseTo(v.diff!, 0);
  }, 600_000);
});
