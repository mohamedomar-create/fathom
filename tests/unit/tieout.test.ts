import { describe, expect, it } from "vitest";
import { tieOut, tieOutSeries } from "@/lib/engine/tieout";

describe("tie-outs: a module against the ledger", () => {
  it("exactMatchIsOk", () => {
    const t = tieOut("cogs", "2026-09", 1000, 1000);
    expect(t.status).toBe("ok");
    expect(t.diff).toBe(0);
    expect(t.causes).toEqual([]);
  });

  it("withinOnePoundIsOk", () => {
    expect(tieOut("cogs", "2026-09", 1000.6, 1000).status).toBe("ok");
    expect(tieOut("cogs", "2026-09", 1001, 1000).status).toBe("ok");
    expect(tieOut("cogs", "2026-09", 1001.01, 1000).status).toBe("off");
  });

  it("overOnePoundIsOffWithCauses", () => {
    const t = tieOut("cogs", "2026-09", 1500, 1000, { module: { "WH/OUT/1": 1000, "WH/OUT/2": 500 }, ledger: { "WH/OUT/1": 1000 } });
    expect(t.status).toBe("off");
    expect(t.diff).toBe(500);
    expect(t.causes[0]).toEqual({ ref: "WH/OUT/2", module: 500, ledger: 0, why: "module_only" });
    expect(t.causes).toHaveLength(1);
  });

  it("orders causes by the largest gap and names ledger-only and differing amounts", () => {
    const t = tieOut("stock_value", "2026-09", 900, 1300, { module: { A: 100, B: 800 }, ledger: { A: 100, B: 900, C: 300 } });
    expect(t.causes.map((c) => [c.ref, c.why])).toEqual([["C", "ledger_only"], ["B", "amount_differs"]]);
  });

  it("missingLedgerMonthIsNoLedger", () => {
    const t = tieOut("cogs", "2026-09", 1000, null);
    expect(t.status).toBe("no_ledger");
    expect(t.diff).toBeNull();
  });

  it("checks every month of a series, with each month's own causes", () => {
    const s = tieOutSeries("cogs", ["2026-08", "2026-09"], { "2026-08": 10, "2026-09": 20 }, { "2026-08": 10 });
    expect(s.map((t) => [t.period, t.status])).toEqual([["2026-08", "ok"], ["2026-09", "no_ledger"]]);
    expect(tieOutSeries("cogs", ["2026-09"], { "2026-09": 20 }, null)[0].status).toBe("no_ledger");
  });
});

describe("tie-outs on quantities", () => {
  it("can require an exact match (quantities, not pounds)", () => {
    expect(tieOut("qty_onhand", "2026-09", 7, 6, undefined, 0).status).toBe("off");
    expect(tieOut("qty_onhand", "2026-09", 6, 6, undefined, 0).status).toBe("ok");
    const t = tieOut("qty_onhand", "2026-09", 7, 6, { module: { P1: 7 }, ledger: { P1: 6 } }, 0);
    expect(t.causes).toEqual([{ ref: "P1", module: 7, ledger: 6, why: "amount_differs" }]);
  });
});
