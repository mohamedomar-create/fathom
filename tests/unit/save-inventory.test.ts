import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StockLayer } from "@/lib/ingest/inventory";

// The server actions are replaced: these tests are about how the browser splits and cleans what it sends.
const calls: { name: string; args: unknown[] }[] = [];
let staged = 0;
let finishResult: () => { ok: true; added: number; already: number } | { ok: false; error: string } = () => ({ ok: true, added: staged, already: 0 });
vi.mock("@/app/company/[id]/settings/inventory-actions", () => ({
  startInventoryBatch: vi.fn(async (input: unknown) => { calls.push({ name: "start", args: [input] }); return { ok: true, batch: "00000000-0000-0000-0000-000000000001" }; }),
  addInventoryRows: vi.fn(async (companyId: string, batch: string, kind: string, rows: unknown[]) => { calls.push({ name: "add", args: [companyId, batch, kind, rows] }); staged += rows.length; return { ok: true, repeated: 0 }; }),
  finishInventoryBatch: vi.fn(async (...args: unknown[]) => { calls.push({ name: "finish", args }); return finishResult(); }),
  setOnHand: vi.fn(async (...args: unknown[]) => { calls.push({ name: "onhand", args }); return { ok: true, saved: 1 }; }),
  setProducts: vi.fn(async (...args: unknown[]) => { calls.push({ name: "products", args }); return { ok: true, saved: 1 }; }),
  startStockLedgerBatch: vi.fn(async (...args: unknown[]) => { calls.push({ name: "startLedger", args }); return { ok: true, batch: "00000000-0000-0000-0000-000000000002" }; }),
  addStockLedgerLines: vi.fn(async (...args: unknown[]) => { calls.push({ name: "addLedger", args }); return { ok: true, saved: (args[2] as unknown[]).length }; }),
}));

const { saveInventory } = await import("@/lib/company/save-inventory");
const CO = "00000000-0000-0000-0000-0000000000c0";
const layer = (i: number, over: Partial<StockLayer> = {}): StockLayer => ({
  key: `svl_${i}`, day: "2026-09-02", period: "2026-09", ref: `WH/IN/${i}`, kind: "receipt", product: "Mask", code: "P1", category: "", lot: "",
  qty: 1, unitValue: 10, value: 10, partner: "", landedRef: "", src: { sheet: "Valuation", row: i }, ...over,
});

beforeEach(() => { calls.length = 0; staged = 0; finishResult = () => ({ ok: true, added: staged, already: 0 }); });

describe("saving Inventory sheets", () => {
  it("savesInChunksOf1000", async () => {
    const r = await saveInventory(CO, { layers: Array.from({ length: 7001 }, (_, i) => layer(i)) }, "valuation.xlsx", "replace");
    expect(calls.filter((c) => c.name === "add").map((c) => (c.args[3] as unknown[]).length)).toEqual([1000, 1000, 1000, 1000, 1000, 1000, 1000, 1]);
    // The upload is finished once, after every chunk: it shows all at once or not at all.
    expect(calls.map((c) => c.name)).toEqual(["start", ...Array(8).fill("add"), "finish"]);
    expect(r).toEqual({ ok: true, added: 7001, already: 0 });
    expect(calls[0]).toMatchObject({ name: "start", args: [{ companyId: CO, kind: "valuation", periods: ["2026-09"], filename: "valuation.xlsx", mode: "replace" }] });
  });

  it("addModeCountsAlreadyHere", async () => {
    finishResult = () => ({ ok: true, added: 0, already: staged });
    const r = await saveInventory(CO, { layers: Array.from({ length: 3000 }, (_, i) => layer(i)) }, "valuation-2.xlsx", "add");
    expect(r).toEqual({ ok: true, added: 0, already: 3000 });
  });

  it("a failed finish saves nothing and says why", async () => {
    finishResult = () => ({ ok: false, error: "mixed keys" });
    const r = await saveInventory(CO, { layers: [layer(1)] }, "v.xlsx", "add");
    expect(r).toEqual({ ok: false, error: "mixed keys" });
  });

  it("stripsTraceAndCutsStrings", async () => {
    await saveInventory(CO, { layers: [layer(1, { product: "x".repeat(400) })] }, "v.xlsx", "replace");
    const sent = (calls.find((c) => c.name === "add")!.args[3] as Record<string, unknown>[])[0];
    expect(sent).not.toHaveProperty("src");
    expect((sent.product as string).length).toBe(300);
    // Column names as the database stores them.
    expect(sent).toMatchObject({ odoo_key: "svl_1", unit_value: 10, landed_ref: "" });
  });

  it("saves moves, the snapshot and products in their own uploads", async () => {
    const r = await saveInventory(CO, {
      moves: [{ key: "sml_1", day: "2026-09-10", period: "2026-09", ref: "WH/INT/1", kind: "rental_out", product: "Device", code: "D1", lot: "S1", from: "WH/Stock", to: "WH/Rental", qty: 1, uom: "Units", partner: "" }],
      onhand: { asOf: "2026-09-30", rows: [{ asOf: "2026-09-30", product: "Mask", code: "P1", location: "WH/Stock", lot: "", qty: 6, value: 600 }] },
      products: [{ code: "P1", name: "Mask", category: "Masks", cost: 100, type: "Goods" }],
    }, "stock.xlsx", "replace");
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.name)).toEqual(["start", "add", "finish", "start", "onhand", "products"]);
    expect((calls[1].args[3] as Record<string, unknown>[])[0]).toMatchObject({ odoo_key: "sml_1", from_loc: "WH/Stock", to_loc: "WH/Rental" });
  });
});

describe("saving the ledger's stock postings", async () => {
  const { saveStockLedger } = await import("@/lib/company/save-inventory");
  it("starts one batch for the months and sends the lines", async () => {
    const r = await saveStockLedger(CO, [{ day: "2026-09-02", period: "2026-09", ref: "WH/IN/1", account: "110500 Stock", amount: 1000 }], "gl.xlsx");
    expect(r).toEqual({ ok: true, saved: 1 });
    expect(calls.map((c) => c.name)).toEqual(["startLedger", "addLedger"]);
    expect(calls[0].args).toEqual([CO, ["2026-09"], "gl.xlsx"]);
  });
  it("saves nothing when there are no stock postings", async () => {
    expect(await saveStockLedger(CO, [], "gl.xlsx")).toEqual({ ok: true, saved: 0 });
    expect(calls).toEqual([]);
  });
});
