// AI assist for a table the rules can't place: only a sample goes out (headings and up to 20 rows, cells cut short), and
// what comes back is checked before it is shown: a module that exists, fields that belong to it, columns in the table.
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { pieceOf } from "@/lib/intake/split";
import { sampleOf, checkSuggestion, SAMPLE_ROWS } from "@/lib/intake/ai-sample";

const g = (rows: unknown[][]): Grid => ({ name: "Weird tab", rows: rows as Grid["rows"] });

describe("the sample sent for AI assist", () => {
  it("holds the headings and at most 20 rows, with long cells cut", () => {
    const rows = [["Cliente", "Fattura", "Scadenza", "Residuo"], ...Array.from({ length: 50 }, (_, i) => [`C${i} ${"x".repeat(200)}`, `F${i}`, "01/10/2026", i])];
    const s = sampleOf(pieceOf(g(rows)));
    expect(SAMPLE_ROWS).toBe(20);
    expect(s.rows.length).toBe(21);
    expect(s.rows[1][0]!.length).toBeLessThanOrEqual(60);
    expect(s.totalRows).toBe(51);
    expect(s.sheet).toBe("Weird tab");
  });
});

describe("checking what comes back", () => {
  const piece = pieceOf(g([["Cliente", "Fattura", "Scadenza", "Residuo"], ["A", "F1", "01/10/2026", 10]]));
  it("turns a valid answer into a mapping the person confirms", () => {
    const ok = checkSuggestion({ module: "ar_open", headerRow: 0, columns: [{ column: 0, field: "party", confidence: 0.9 }, { column: 1, field: "doc", confidence: 0.8 }, { column: 2, field: "due", confidence: 0.9 }, { column: 3, field: "open", confidence: 0.7 }], reason: "Italian receivables list" }, piece);
    expect(ok).toMatchObject({ module: "ar_open", headerRow: 0, override: { 0: "party", 1: "doc", 2: "due", 3: "open" } });
  });

  it("drops fields that aren't the module's, columns outside the table, and a module that doesn't exist", () => {
    const bad = checkSuggestion({ module: "ar_open", headerRow: 0, columns: [{ column: 0, field: "party", confidence: 0.9 }, { column: 9, field: "doc", confidence: 1 }, { column: 1, field: "salary", confidence: 1 }], reason: "x" }, piece);
    expect(bad?.override).toEqual({ 0: "party" });
    expect(checkSuggestion({ module: "payroll", headerRow: 0, columns: [], reason: "x" }, piece)).toBeNull();
    expect(checkSuggestion({ module: "ar_open", headerRow: 99, columns: [], reason: "x" }, piece)).toBeNull();
  });

  it("says none when the model found no module", () => {
    expect(checkSuggestion({ module: "none", headerRow: 0, columns: [], reason: "notes" }, piece)).toBeNull();
  });
});
