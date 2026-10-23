import { describe, expect, it } from "vitest";
import { inspectWorkbook, runPreflight } from "@/lib/preflight";
import type { Grid } from "@/lib/ingest/extract";
import { CLEAN_EXPENSES, MINIMAL_SALES } from "../fixtures/simple";

const grid = (name: string, rows: unknown[][]): Grid => ({ name, rows: rows as Grid["rows"] });

describe("preflight checks a Simple sheet with the Simple columns", () => {
  it("a Payment date column is the paid-on date, not a second Date to choose between", () => {
    const g = [grid("Expenses", CLEAN_EXPENSES)];
    const simple = inspectWorkbook(g, "expenses", { simple: true });
    expect(simple.sheets[0].issues.filter((i) => i.code === "ambiguous_column")).toEqual([]);
    expect(simple.ready).toBe(true);
    // Full mode is unchanged: there the two date columns are still put to the person.
    const full = inspectWorkbook(g, "expenses");
    expect(full.sheets[0].issues.some((i) => i.code === "ambiguous_column")).toBe(true);
  });
  it("a sheet of only Date and Amount is a sales list in Simple mode", () => {
    const r = inspectWorkbook([grid("Sales", MINIMAL_SALES)], "sales", { simple: true });
    expect(r.sheets[0].status).toBe("ready");
  });
  it("the cleaned copy is checked with the same Simple rules", () => {
    const run = runPreflight([grid("Expenses", CLEAN_EXPENSES)], "expenses", {}, undefined, undefined, true);
    expect(run.final.ready).toBe(true);
    expect(run.cleaned.grids[0].rows[0]).toContain("Payment date");
  });
});
