// Two tabs for the same module are saved as one save, so the second never replaces the first one's months; a document
// in both (an invoice list and its lines) is kept once, from the tab with more detail.
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { planIntake } from "@/lib/intake/plan";
import { combineForSave } from "@/lib/intake/combine";

const g = (name: string, rows: unknown[][]): Grid => ({ name, rows: rows as Grid["rows"] });

describe("tabs of the same module", () => {
  it("are saved together, each document once", () => {
    const plan = planIntake([
      g("Invoices", [["Invoice", "Customer", "Invoice date", "Total"], ["INV/1", "Nile", "01/10/2026", 114], ["INV/9", "Delta", "02/10/2026", 228]]),
      g("Sales", [["Date", "Invoice", "Customer", "Product", "Quantity", "Untaxed Amount"], ["01/10/2026", "INV/1", "Nile", "Mask", 1, 60], ["01/10/2026", "INV/1", "Nile", "Pump", 1, 40]]),
    ]);
    expect(plan.pieces.map((p) => p.module)).toEqual(["sales", "sales"]);
    const groups = combineForSave(plan.pieces);
    expect(groups).toHaveLength(1);
    const s = groups[0];
    expect(s.module).toBe("sales");
    // INV/1 from the lines tab (two products); INV/9 only in the invoice list.
    expect(s.records.map((r) => `${r.doc}:${r.untaxed ?? r.total}`).sort()).toEqual(["INV/1:40", "INV/1:60", "INV/9:228"]);
    expect(s.dropped).toEqual([{ piece: "Invoices", docs: 1, rows: 1 }]);
    expect(s.pieces.map((p) => p.id)).toEqual(["Invoices", "Sales"]);
  });

  it("refuse two open-items lists for the same side and day (one would replace the other)", () => {
    const ar = (n: string) => g(n, [["Customer", "Invoice", "Due date", "Balance due"], ["Nile", `INV/${n}`, "01/10/2026", 100]]);
    const groups = combineForSave(planIntake([ar("AR1"), ar("AR2")], { asOf: "2026-10-31" }).pieces);
    expect(groups).toHaveLength(1);
    expect(groups[0].records).toHaveLength(2);
  });
});
