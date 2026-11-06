// What each module's save is sent: one save per module, named by the workbook and its tabs (so an earlier upload with
// the same tab name is never taken for this one), every month it replaces listed, and its money equal to the records'.
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { planIntake } from "@/lib/intake/plan";
import { combineForSave } from "@/lib/intake/combine";
import { prepareGroup } from "@/lib/intake/prepare";

const g = (name: string, rows: unknown[][]): Grid => ({ name, rows: rows as Grid["rows"] });

describe("preparing a save", () => {
  const plan = planIntake([
    g("Sales Cairo", [["Date", "Invoice", "Customer", "Product", "Untaxed Amount"], ["01/10/2026", "INV/1", "A", "Mask", 100]]),
    g("Sales Alex", [["Date", "Invoice", "Customer", "Product", "Untaxed Amount"], ["15/10/2026", "INV/2", "B", "Pump", 50], ["03/11/2026", "INV/3", "C", "Pump", 25]]),
  ]);
  it("makes one sales save covering both tabs' months, with both tabs' lines", () => {
    const groups = combineForSave(plan.pieces);
    expect(groups).toHaveLength(1);
    const p = prepareGroup(groups[0], "EGP", "Q4 pack.xlsx");
    expect(p.kind).toBe("sales");
    expect(p.months).toEqual(["2026-10", "2026-11"]);
    expect(p.lines).toHaveLength(3);
    expect(p.name).toBe("Q4 pack.xlsx › Sales Cairo, Sales Alex");
    expect(p.report).toMatchObject({ mode: "intake" });
    expect(p.check).toEqual({ records: 175, sent: 175, ok: true });
    expect(p.unsaved).toEqual([]);
  });

  it("names any record it can't send (no month) instead of dropping it", () => {
    const pl = planIntake([g("Pay", [["Date", "Number", "Journal", "Partner", "Amount"], ["01/10/2026", "P1", "Bank", "A", 100]])]);
    const grp = combineForSave(pl.pieces)[0];
    grp.records.push({ ...grp.records[0], date: null, __period: null, __row: 9 });
    const p = prepareGroup(grp, "EGP", "f.xlsx");
    expect(p.unsaved).toEqual([{ row: 9, sheet: "Pay", reason: "no date to save it under" }]);
    expect(p.check.ok).toBe(true);
  });
});
