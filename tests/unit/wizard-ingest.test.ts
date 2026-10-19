// The upload's reading runs in a background worker: the same function, whether in the worker or (no worker) on the page,
// gives exactly what the page used to work out itself, and the lines the ledger gives (sales, expenses, stock, payments).
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorkbooks } from "@/lib/ingest/read";
import { extractAll, runIngest } from "@/lib/ingest/pipeline";
import { salesFromLedger } from "@/lib/ingest/sales";
import { expensesFromLedger } from "@/lib/ingest/expenses";
import { computeIngest, deriveLedgerLines, slimOutcome } from "@/lib/ingest/wizard-ingest";

const load = async (f: string) => { const b = fs.readFileSync(`tests/fixtures/files/${f}`); return readWorkbooks([{ name: f, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }]); };
const opts = { fyStart: 1, ytd: "auto" as const, closeEarnings: "auto" as const, plugEquity: false };

describe("the upload's reading, off the page", () => {
  it("gives the same result as reading on the page, with the books start suggested from the file", async () => {
    const grids = await load("egypt-odoo-general-ledger.xlsx");
    const out = computeIngest(grids, { kind: "accounts", overrides: {}, opts, mapping: {}, startChoice: undefined, savedStart: null, asAtChoice: undefined });
    const { raw, issues } = extractAll(grids, {});
    expect(out.err).toBeNull();
    expect(out.res).toEqual(runIngest(raw, issues, { ...opts, mapping: {} }));
    expect(out.raw.length).toBe(raw.length);
  });

  it("works out the ledger's lines from the same reading", async () => {
    const grids = await load("egypt-odoo-general-ledger.xlsx");
    const out = computeIngest(grids, { kind: "accounts", overrides: {}, opts, mapping: {}, startChoice: undefined, savedStart: null, asAtChoice: undefined });
    const d = deriveLedgerLines(out.res!.lines);
    expect(d.sales).toEqual(salesFromLedger(out.res!.lines));
    expect(d.expenses).toEqual(expensesFromLedger(out.res!.lines));
    expect(d.payments.lines.length).toBeGreaterThan(0);
  });

  it("the page gets the reading without the ledger's entries (they stay in the worker), only how many each account has", async () => {
    const grids = await load("egypt-odoo-general-ledger.xlsx");
    const full = computeIngest(grids, { kind: "accounts", overrides: {}, opts, mapping: {}, startChoice: undefined, savedStart: null, asAtChoice: undefined });
    const slim = slimOutcome(full);
    expect(slim.res!.lines.every((l) => l.entries === undefined)).toBe(true);
    expect(slim.res!.lines.map((l) => l.entryCount)).toEqual(full.res!.lines.map((l) => l.entries?.length ?? 0));
    expect(slim.raw.every((r) => r.entries === undefined)).toBe(true);
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(full).length / 2);
    expect({ ...slim.res, lines: [] }).toEqual({ ...full.res, lines: [] });
  });

  it("a file that can't be analysed gives the reason, not a crash", () => {
    const out = computeIngest([{ name: "x", rows: [["a"]] } as never], { kind: "opening", overrides: {}, opts, mapping: {}, startChoice: undefined, savedStart: null, asAtChoice: "2026-02-15" });
    expect(out.res).toBeNull();
    expect(out.err).toMatch(/month end/);
  });
});
