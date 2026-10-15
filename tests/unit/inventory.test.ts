import { describe, expect, it } from "vitest";
import { EMPTY_INVENTORY, inventoryAnalysis, type InventoryData, type LayerKind, type MoveKind } from "@/lib/engine/inventory";

// Made-up products and documents (the repo is public). FIFO values are worked by hand.
const layer = (p: string, kind: LayerKind, code: string, q: number, v: number) => ({ p, kind, code, product: code === "P1" ? "Mask" : `Item ${code}`, category: "", q, v, n: 1 });
const move = (p: string, kind: MoveKind, code: string, from: string, to: string, q: number) => ({ p, kind, code, product: code, from, to, q, n: 1 });
const data = (over: Partial<InventoryData>): InventoryData => ({ ...EMPTY_INVENTORY, ...over, meta: { ...EMPTY_INVENTORY.meta, ...(over.meta ?? {}) } });
const SEP = { type: "month" as const, end: "2026-09" };

/** Two receipts at 100 and 110, a landed cost, 15 delivered (FIFO 10×100 + 5×110 = 1,550), one returned (110), one scrapped (110). */
function fifo(landed = 120): InventoryData {
  return data({
    layers: [
      layer("2026-09", "receipt", "P1", 20, 2100),
      layer("2026-09", "landed_cost", "P1", 0, landed),
      layer("2026-09", "delivery", "P1", -15, -1550),
      layer("2026-09", "customer_return", "P1", 1, 110),
      layer("2026-09", "scrap", "P1", -1, -110),
    ],
    byRef: [
      { p: "2026-09", ref: "WH/IN/00001", kind: "receipt", v: 1000 }, { p: "2026-09", ref: "WH/IN/00002", kind: "receipt", v: 1100 },
      { p: "2026-09", ref: "LC/2026/0001", kind: "landed_cost", v: landed }, { p: "2026-09", ref: "WH/OUT/00001", kind: "delivery", v: -1550 },
      { p: "2026-09", ref: "WH/RET/00001", kind: "customer_return", v: 110 }, { p: "2026-09", ref: "SP/00001", kind: "scrap", v: -110 },
    ],
    lastOut: { P1: "2026-09-20" },
    meta: { withIds: true, kinds: ["valuation"], periods: ["2026-09"] },
  });
}

describe("Inventory engine", () => {
  it("bridgeClosesToTheCent", () => {
    const a = inventoryAnalysis(fifo(), SEP, 1, { ledger: { stock: null, cogs: null } });
    expect(a.bridge).toEqual({ opening: 0, receipts: 2100, landed: 120, deliveries: -1550, returns: 110, adjustments: -110, revaluation: 0, closing: 670 });
    const b = a.bridge!;
    expect(b.opening + b.receipts + b.landed + b.deliveries + b.returns + b.adjustments + b.revaluation).toBe(b.closing);
    expect(a.tiles.value).toBe(670);
    expect(a.tiles.cogs).toBe(1440);
  });

  it("cogsTiesToLedger", () => {
    const a = inventoryAnalysis(fifo(), SEP, 1, { ledger: { stock: { "2026-08": 0, "2026-09": 670 }, cogs: { "2026-09": 1440 } } });
    const t = (k: string) => a.tieouts.find((x) => x.key === k)!;
    expect(t("cogs")).toMatchObject({ status: "ok", module: 1440, ledger: 1440 });
    expect(t("stock_value")).toMatchObject({ status: "ok", module: 670, ledger: 670 });
    expect(t("stock_movement")).toMatchObject({ status: "ok", module: 670, ledger: 670 });
  });

  it("stockValueOffNamesTheRef", () => {
    const d = fifo(300);
    d.ledger = d.byRef.filter((r) => r.ref !== "LC/2026/0001").map((r) => ({ p: r.p, ref: r.ref, v: r.v }));
    const a = inventoryAnalysis(d, SEP, 1, { ledger: { stock: { "2026-09": 550 }, cogs: null } });
    const t = a.tieouts.find((x) => x.key === "stock_value")!;
    expect(t).toMatchObject({ status: "off", module: 850, ledger: 550, diff: 300 });
    expect(t.causes[0]).toEqual({ ref: "LC/2026/0001", module: 300, ledger: 0, why: "module_only" });
    expect(a.findings.some((f) => f.kind === "risk" && /Sep 2026/.test(f.title))).toBe(true);
  });

  it("receiptsTieToTheLedgerPostings", () => {
    const d = fifo();
    d.ledger = d.byRef.map((r) => ({ p: r.p, ref: r.ref, v: r.v }));
    const a = inventoryAnalysis(d, SEP, 1, { ledger: { stock: { "2026-09": 670 }, cogs: null } });
    expect(a.tieouts.find((x) => x.key === "receipts")).toMatchObject({ status: "ok", module: 2220, ledger: 2220 });
  });

  it("rentalMovesCarryNoValue", () => {
    const d = data({ moves: [move("2026-09", "rental_out", "D1", "WH/Stock", "WH/Rental", 1), move("2026-09", "rental_back", "D1", "WH/Rental", "WH/Stock", 1)], rental: [{ p: "2026-09", ref: "WH/INT/00007" }] });
    expect(inventoryAnalysis(d, SEP, 1, { ledger: { stock: null, cogs: null } }).tieouts.find((x) => x.key === "rental_value")).toMatchObject({ status: "ok", module: 0 });
    d.byRef = [{ p: "2026-09", ref: "WH/INT/00007", kind: "other", v: 50 }];
    d.layers = [layer("2026-09", "other", "D1", 0, 50)];
    const t = inventoryAnalysis(d, SEP, 1, { ledger: { stock: null, cogs: null } }).tieouts.find((x) => x.key === "rental_value")!;
    expect(t).toMatchObject({ status: "off", module: 50, ledger: 0 });
    expect(t.causes[0].ref).toBe("WH/INT/00007");
  });

  it("movesOnlyGivesQuantitiesAndNoValueTieOuts", () => {
    const d = data({ moves: [move("2026-09", "receipt", "P1", "Partners/Vendors", "WH/Stock", 10), move("2026-09", "delivery", "P1", "WH/Stock", "Partners/Customers", 4)] });
    const a = inventoryAnalysis(d, SEP, 1, { ledger: { stock: { "2026-09": 600 }, cogs: { "2026-09": 400 } } });
    expect(a.hasValue).toBe(false);
    expect(a.hasMoves).toBe(true);
    expect(a.tiles.value).toBeNull();
    expect(a.bridge).toBeNull();
    expect(a.tieouts.map((t) => t.key)).toEqual(["rental_value"]);
    expect(a.movements).toEqual([{ p: "2026-09", kind: "receipt", q: 10 }, { p: "2026-09", kind: "delivery", q: 4 }]);
    expect(a.locations.find((l) => l.loc === "WH/Stock")).toEqual({ loc: "WH/Stock", inQ: 10, outQ: 4 });
  });

  it("checks stock value only when the valuation export starts at the first stock month", () => {
    const a = inventoryAnalysis(fifo(), SEP, 1, { ledger: { stock: { "2026-08": 5000, "2026-09": 5670 }, cogs: null } });
    expect(a.partialValuation).toBe(true);
    expect(a.tieouts.find((x) => x.key === "stock_value")).toBeUndefined();
    // The month's movement still checks: 670 in layers against 5,670 − 5,000 in the ledger.
    expect(a.tieouts.find((x) => x.key === "stock_movement")).toMatchObject({ status: "ok", module: 670, ledger: 670 });
  });

  it("a month the ledger does not hold is no_ledger, never off", () => {
    const a = inventoryAnalysis(fifo(), SEP, 1, { ledger: { stock: { "2026-08": 0 }, cogs: {} } });
    expect(a.tieouts.find((x) => x.key === "cogs")!.status).toBe("no_ledger");
    expect(a.tieouts.find((x) => x.key === "stock_movement")!.status).toBe("no_ledger");
  });

  it("slowAndDeadByLastOut", () => {
    const d = data({
      layers: [layer("2026-01", "receipt", "P1", 5, 500), layer("2026-01", "receipt", "P2", 5, 700), layer("2026-01", "receipt", "P3", 5, 900)],
      lastOut: { P1: "2026-06-22", P2: "2026-03-14", P3: "2026-09-25" },
    });
    const a = inventoryAnalysis(d, SEP, 1, { ledger: { stock: null, cogs: null }, today: "2026-09-30" });
    const flag = (c: string) => a.products.find((p) => p.code === c)!.flag;
    expect([flag("P1"), flag("P2"), flag("P3")]).toEqual(["slow", "dead", null]);
    expect(a.tiles.slow).toBe(500);
    expect(a.tiles.dead).toBe(700);
  });

  it("abcByCostOfSales", () => {
    const d = data({
      layers: [
        layer("2026-08", "receipt", "P1", 10, 1000), layer("2026-08", "receipt", "P2", 10, 1000), layer("2026-08", "receipt", "P3", 10, 1000),
        layer("2026-09", "delivery", "P1", -8, -800), layer("2026-09", "delivery", "P2", -1.5, -150), layer("2026-09", "delivery", "P3", -0.5, -50),
      ],
    });
    const a = inventoryAnalysis(d, SEP, 1, { ledger: { stock: null, cogs: null } });
    expect(["P1", "P2", "P3"].map((c) => a.products.find((p) => p.code === c)!.abc)).toEqual(["A", "B", "C"]);
    expect(a.products.find((p) => p.code === "P1")).toMatchObject({ value: 200, qty: 2, cogs: 800 });
  });

  it("onHandMatchesMoves", () => {
    const base = { moves: [move("2026-09", "receipt", "P1", "Partners/Vendors", "WH/Stock", 10), move("2026-09", "delivery", "P1", "WH/Stock", "Partners/Customers", 4), move("2026-09", "rental_out", "P1", "WH/Stock", "WH/Rental", 2)] };
    const onhand = (q: number) => [{ asOf: "2026-09-30", product: "Mask", code: "P1", location: "WH/Stock", lot: "", qty: q, value: null }];
    const ok = inventoryAnalysis(data({ ...base, onhand: onhand(6) }), SEP, 1, { ledger: { stock: null, cogs: null } });
    expect(ok.tieouts.find((t) => t.key === "qty_onhand")).toMatchObject({ status: "ok", module: 6, ledger: 6 });
    const off = inventoryAnalysis(data({ ...base, onhand: onhand(7) }), SEP, 1, { ledger: { stock: null, cogs: null } }).tieouts.find((t) => t.key === "qty_onhand")!;
    expect(off.status).toBe("off");
    expect(off.causes[0].ref).toBe("P1");
  });

  it("flags negative stock and adjustments above 1% of cost of sales", () => {
    const d = fifo();
    d.layers.push(layer("2026-09", "adjustment", "P1", -1, -100));
    d.onhand = [{ asOf: "2026-09-30", product: "Mask", code: "P1", location: "WH/Stock", lot: "", qty: -2, value: null }];
    const a = inventoryAnalysis(d, SEP, 1, { ledger: { stock: null, cogs: null } });
    expect(a.findings.some((f) => f.kind === "risk" && /negative/i.test(f.title))).toBe(true);
    expect(a.findings.some((f) => /adjustments and scrap/i.test(f.title))).toBe(true);
  });

  it("writes the headline and findings in Arabic with the same figures", () => {
    const en = inventoryAnalysis(fifo(), SEP, 1, { ledger: { stock: null, cogs: null } });
    const ar = inventoryAnalysis(fifo(), SEP, 1, { ledger: { stock: null, cogs: null }, lang: "ar" });
    expect(/[؀-ۿ]/.test(ar.headline)).toBe(true);
    expect(ar.tiles).toEqual(en.tiles);
    expect(en.headline).toContain("670");
  });
});

describe("demo company stock", async () => {
  const sample = (await import("../../reference/sample.json")).default;
  const { demoInventory } = await import("@/lib/company/demo-inventory");
  const { demoExpenses } = await import("@/lib/company/demo-expenses");
  const { inventoryLedger } = await import("@/lib/engine/inventory");
  const months = sample.months as import("@/lib/engine").MonthData[];
  const ledger = inventoryLedger(months, demoExpenses());

  it("demoTiesOutEveryMonth", () => {
    const d = demoInventory();
    // Every month after the first (the first has no month before it to measure movement against).
    for (const m of months.slice(1)) {
      const a = inventoryAnalysis(d, { type: "month", end: m.period }, sample.fy_start_month, { ledger, today: "2026-09-30" });
      expect(a.tieouts.length).toBeGreaterThanOrEqual(5);
      for (const t of a.tieouts) expect(t.status, `${t.key} ${t.period}: module ${t.module}, ledger ${t.ledger}`).toBe("ok");
    }
    const year = inventoryAnalysis(d, { type: "year", end: "2026-09" }, sample.fy_start_month, { ledger, today: "2026-09-30" });
    expect(year.tieouts.some((t) => t.key === "qty_onhand" && t.status === "ok")).toBe(true);
    expect(year.products.length).toBeGreaterThanOrEqual(6);
  });

  it("the demo's cost of sales from stock is the cost-of-goods account in its accounts", () => {
    for (const m of months) expect(ledger.cogs![m.period]).toBeGreaterThan(0);
    expect(ledger.stock!["2026-09"]).toBe(months.find((m) => m.period === "2026-09")!.bs.inventory);
  });
});
