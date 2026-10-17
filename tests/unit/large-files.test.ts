import { describe, expect, it } from "vitest";
import { diagnostic } from "@/lib/ingest/diagnostic";

describe("very large exports", () => {
  it("a General Ledger of 150,000 rows is summarised without running out of stack", () => {
    const rows = Array.from({ length: 150_000 }, (_, i) => (i === 7 ? ["a", "b", "c", "d"] : ["x", 1]));
    const d = diagnostic([{ name: "gl.xlsx", size: 6_700_000 }], [{ name: "General Ledger", rows }], { warnings: [], skippedCols: [] });
    expect(d.sheets[0]).toMatchObject({ rows: 150_000, cols: 4 });
  });
});
