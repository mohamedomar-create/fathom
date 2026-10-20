// The server's own checks: a stored file preflight cannot import is refused before any row is sent, and saved lines are
// refused (naming the line) when their date is not in their month or a required value is missing.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { lineProblem, preflightGate, zodProblem } from "@/lib/preflight/server";

describe("the server's preflight gate", () => {
  it("refuses a file with a sheet that cannot be imported, saying why", () => {
    const why = preflightGate([{ name: "V", rows: [["Date", "Product", "Reference", "Total Value"], ["2026-09-01", "[A1] Pump", "WH/IN/1", 10]] }], "stock");
    expect(why).toMatch(/^V: No column for the Quantity/);
  });
  it("lets a ready file through", () => {
    expect(preflightGate([{ name: "S", rows: [["Date", "Untaxed Amount"], ["2026-09-01", 10]] }], "sales")).toBeNull();
  });
});

describe("saved lines", () => {
  it("a line dated outside its own month is named", () => {
    expect(lineProblem([{ day: "2026-09-30", period: "2026-09" }, { day: "2026-10-01", period: "2026-09" }], "sales line")).toBe("Sales line 2: its date 2026-10-01 is not in its month 2026-09.");
    expect(lineProblem([{ day: null, period: "2026-09" }], "sales line")).toBeNull();
  });
  it("a schema failure names the line and the field", () => {
    const r = z.array(z.object({ amount: z.number() })).safeParse([{ amount: 1 }, { amount: "x" }]);
    expect(r.success).toBe(false);
    if (!r.success) expect(zodProblem(r.error, "expense line")).toMatch(/^Expense line 2, amount: /);
  });
});
