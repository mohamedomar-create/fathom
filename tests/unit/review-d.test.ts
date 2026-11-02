// Release D review findings, each reproduced before its fix.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ledgerClear } from "@/lib/company/add-mode";
import { ledgerStep } from "@/lib/company/ledger-tie";
import { storedFill } from "@/lib/templates/fill";
import { buildTemplate } from "@/lib/templates/build";
import { extractGrid } from "@/lib/ingest/extract";
const { readAllLines } = await import("@/lib/export/parts");

describe("C1: the export reads every line even when the API returns at most 1,000 rows a request", () => {
  it("12,000 lines all come back", async () => {
    const from = () => {
      let after = 0, size = 0;
      const q = { select: () => q, eq: () => q, gt: (_c: string, v: number) => { after = v; return q; }, order: () => q, limit: (l: number) => { size = Math.min(l, 1000); return q; },
        then: (ok: (v: { data: unknown[]; error: null }) => void) => ok({ data: Array.from({ length: Math.max(0, Math.min(size, 12_000 - after)) }, (_, i) => ({ id: after + i + 1, period: "2026-01" })), error: null }) };
      return q;
    };
    expect(await readAllLines({ from } as never, "sales_lines", "co")).toHaveLength(12_000);
  });
});

describe("I1: a ledger uploaded with a balances file replaces detail only for the ledger's own months", () => {
  it("GL Jan–Mar with a TB Jan–Dec clears Jan–Mar only", () => {
    const touched = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
    expect(ledgerClear("merge", { ledgerMonths: ["2026-01", "2026-02", "2026-03"], touchedPL: touched, preStart: [] }).months).toEqual(["2026-01", "2026-02", "2026-03"]);
  });
});

describe("I2: an undo or restore reports kept detail that differs; it removes only detail for months with no figures left", () => {
  it("a month with figures that differ is reported, a month with no P&L is cleared", () => {
    const step = ledgerStep({ sales: { "2026-01": 900, "2026-02": 500 }, expenses: {} }, [{ cls: "revenue", amounts: { "2026-01": 1000 } }]);
    expect(step.clear).toEqual({ sales: ["2026-02"], expenses: [] });
    expect(step.drift.map((d) => d.period)).toEqual(["2026-01"]);
  });
});

describe("I3: a blank template for fewer than 12 months builds", () => {
  it("three months", async () => {
    await expect(buildTemplate("financials", { year: 2026, fyStart: 1, currency: "EGP", months: ["2026-06", "2026-07", "2026-08"] })).resolves.toBeTruthy();
  });
});

describe("I4: an account without a code is not repeated from the account map", () => {
  it("one row for Owner's Capital", () => {
    const f = storedFill([{ id: "1", code: "", name: "Owner's Capital", cls: "other_equity", amounts: { "2026-01": 5 } }], [{ key: "owner's capital", cls: "other_equity", name: "Owner's Capital" }]);
    expect(f.bs!.rows).toHaveLength(1);
  });
});

describe("I5: a journal-items file with no title is not a part month because of its last posting day", () => {
  it("a full September ending on the 29th", () => {
    const iss = { skippedCols: [], warnings: [] } as never as Parameters<typeof extractGrid>[1];
    extractGrid({ name: "JI", rows: [["Date", "Code", "Name", "Debit", "Credit"], ["01/09/2026", "410000", "Revenues", 0, 10], ["29/09/2026", "121000", "Bank", 10, 0]] }, iss, {}, "2026-11-02");
    expect(iss.layouts![0].source).toBe("Odoo Journal Items");
    expect(iss.layouts![0].asOf).toBeUndefined();
  });
});
