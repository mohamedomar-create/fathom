// Phase 3b: inventory to standard. ABC on a rolling 12 months to the selected month, stock by location at the selected
// month end (not only the latest), and a history of units and value by month, category and location.
import { describe, expect, it } from "vitest";
import { positionAt, rollingAbc, stockHistory } from "@/lib/engine/inventory-more";
import { EMPTY_INVENTORY, type InventoryData } from "@/lib/engine/inventory";

const layer = (p: string, kind: "receipt" | "delivery", code: string, category: string, q: number, v: number) => ({ p, kind, code, product: code, category, q, v, n: 1 });
const d: InventoryData = {
  ...EMPTY_INVENTORY,
  layers: [
    layer("2025-01", "receipt", "OLD", "Spares", 100, 1000), layer("2025-02", "delivery", "OLD", "Spares", -90, -900),
    layer("2025-12", "receipt", "A1", "Machines", 10, 10000), layer("2026-03", "delivery", "A1", "Machines", -5, -5000),
    layer("2026-01", "receipt", "B1", "Spares", 50, 500), layer("2026-02", "delivery", "B1", "Spares", -10, -100),
  ],
  moves: {
    ...EMPTY_INVENTORY.moves,
    months: ["2025-12", "2026-01", "2026-02", "2026-03"],
    flow: [
      { p: "2025-12", loc: "WH/Stock", inQ: 10, outQ: 0 }, { p: "2026-01", loc: "WH/Stock", inQ: 50, outQ: 0 },
      { p: "2026-02", loc: "WH/Stock", inQ: 0, outQ: 20 }, { p: "2026-02", loc: "Rental/Out", inQ: 10, outQ: 0 },
      { p: "2026-03", loc: "WH/Stock", inQ: 0, outQ: 5 }, { p: "2026-03", loc: "Partners/Customers", inQ: 5, outQ: 0 },
    ],
    rentalLocs: ["Rental/Out"],
  },
};

describe("rolling 12-month ABC", () => {
  it("classes products by cost of sales over the 12 months to the selected month, not the selected month alone", () => {
    const abc = rollingAbc(d, "2026-03");
    // A1 (5,000) and B1 (100): OLD's deliveries are more than 12 months back and don't count.
    expect(abc.get("[A1] A1")).toBe("A");
    expect(abc.get("[B1] B1")).toBe("C");
    expect(abc.has("[OLD] OLD")).toBe(false);
    // Picking February alone would leave A1 out (no deliveries that month); the rolling window still includes Mar 2025 – Feb 2026.
    expect(rollingAbc(d, "2026-02").get("[B1] B1")).toBe("A");
  });
});

describe("stock by location at a month end", () => {
  it("adds up each location's moves to the month chosen, for the locations that hold stock", () => {
    expect(positionAt(d, "2026-02")).toEqual([{ loc: "WH/Stock", type: "internal", units: 40 }, { loc: "Rental/Out", type: "rental", units: 10 }]);
    expect(positionAt(d, "2026-01")).toEqual([{ loc: "WH/Stock", type: "internal", units: 60 }]);
  });
});

describe("stock history", () => {
  it("units and value at each month end, by category and by location", () => {
    const h = stockHistory(d, "2026-03", 3);
    expect(h.map((x) => x.p)).toEqual(["2026-01", "2026-02", "2026-03"]);
    const feb = h[1];
    expect(feb).toMatchObject({ units: 60, value: 10500 });
    expect(feb.byCategory).toEqual({ Machines: { units: 10, value: 10000 }, Spares: { units: 50, value: 500 } });
    expect(feb.byLocation).toEqual({ "WH/Stock": 40, "Rental/Out": 10 });
  });
});

describe("units of measure and rental (0045)", () => {
  it("the summary carries products in more than one unit and rental moves by customer", async () => {
    const { fromWire } = await import("@/lib/company/inventory-wire");
    const w = { v: 3, prods: [["V1", "Vent", "Machines"], ["F1", "Filter", "Spares"]], layers: [], mk: [], flow: [], pl: [], asOf: null, moveMonths: [], rentalLocs: [], lastOut: {}, onhand: [], products: [], byRef: [], ledger: [], rv: [], meta: {},
      uoms: [[1, ["Units", "Box of 10"]]], rent: [["2026-02", 0, "Al Salam Hospital", "Rental/Out", 3]] };
    const d = fromWire(w);
    expect(d.uomMixed).toEqual([{ code: "F1", product: "Filter", uoms: ["Units", "Box of 10"] }]);
    expect(d.rentals).toEqual([{ p: "2026-02", code: "V1", product: "Vent", partner: "Al Salam Hospital", loc: "Rental/Out", q: 3 }]);
  });

  it("units of a product kept in more than one unit are never added: left out of the unit totals and named", async () => {
    const { stockHistory, mixedUnits } = await import("@/lib/engine/inventory-more");
    const dd: InventoryData = { ...d, uomMixed: [{ code: "B1", product: "B1", uoms: ["Units", "Box"] }] };
    const feb = stockHistory(dd, "2026-02", 1)[0];
    expect(feb.units).toBe(20); // OLD 10 + A1 10; B1's 40 left out
    expect(feb.byCategory.Spares).toEqual({ units: 10, value: 500 }); // value still counted
    expect(mixedUnits(dd)).toMatchObject({ count: 1, text: expect.stringMatching(/B1 \(Units, Box\)/) });
  });

  it("rental: on rent and idle at the period end, utilisation over the window, by location and customer", async () => {
    const { rentalStatus } = await import("@/lib/engine/inventory-more");
    const rd: InventoryData = {
      ...EMPTY_INVENTORY,
      layers: [layer("2026-01", "receipt", "V1", "Machines", 10, 100000)],
      rentals: [
        { p: "2026-01", code: "V1", product: "V1", partner: "Salam", loc: "Rental/Out", q: 4 },
        { p: "2026-02", code: "V1", product: "V1", partner: "Nile", loc: "Rental/Out", q: 4 },
        { p: "2026-03", code: "V1", product: "V1", partner: "Salam", loc: "Rental/Out", q: -2 },
      ],
    };
    const r = rentalStatus(rd, "2026-03", 3);
    expect(r.items).toEqual([{ code: "V1", product: "V1", fleet: 10, onRent: 6, idle: 4, utilisation: 0.6 }]); // month ends 4, 8, 6 of 10
    expect(r.byCustomer).toEqual([{ partner: "Nile", units: 4 }, { partner: "Salam", units: 2 }]);
    expect(r.byLocation).toEqual([{ loc: "Rental/Out", units: 6 }]);
    expect(r.utilisation).toBe(0.6);
  });
});
