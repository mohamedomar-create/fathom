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
