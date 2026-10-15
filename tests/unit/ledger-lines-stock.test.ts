import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const { clearLedger, saveLedgerLines } = await import("@/lib/company/ledger-lines");

/** A stand-in for the Supabase client that records what is asked of it. */
function fake(rpcResult: (fn: string) => { data: unknown; error: null | { code?: string; message: string } } = () => ({ data: "b1", error: null })) {
  const log: string[] = [];
  const query = (table: string) => {
    const q = {
      delete: () => { log.push(`delete ${table}`); return q; },
      select: () => q, update: () => q, insert: () => q, single: () => q,
      eq: () => q, in: (col: string, vals: string[]) => { log.push(`in ${table} ${col}=${vals.join(",")}`); return q; },
      then: (ok: (v: { data: unknown[]; error: null }) => void) => ok({ data: [], error: null }),
    };
    return q;
  };
  const supabase = { from: (t: string) => query(t), rpc: async (fn: string, args: unknown) => { log.push(`rpc ${fn} ${JSON.stringify(args)}`); return rpcResult(fn); } };
  return { supabase: supabase as never, log };
}

describe("the ledger's stock postings follow the accounts", () => {
  it("clearing ledger months also clears their stock postings", async () => {
    const { supabase, log } = fake();
    await clearLedger(supabase, "co", ["2026-09"]);
    expect(log).toContain("delete stock_ledger_lines");
    expect(log).toContain("in stock_ledger_lines period=2026-09");
    expect(log).toContain("delete expense_lines");
  });

  it("clearing everything also removes every stock-postings upload", async () => {
    const { supabase, log } = fake();
    await clearLedger(supabase, "co", "all");
    expect(log).toContain("delete stock_ledger_batches");
  });

  it("the Odoo sync saves stock postings through their own functions", async () => {
    const { supabase, log } = fake((fn) => ({ data: fn === "begin_stock_ledger_batch" ? "b9" : 1, error: null }));
    const n = await saveLedgerLines(supabase, "co", "u", "stock", [{ day: "2026-09-02", period: "2026-09", ref: "WH/IN/1", account: "110500 Stock", amount: 1000 }], "Odoo");
    expect(n).toBe(1);
    expect(log[0]).toBe('rpc begin_stock_ledger_batch {"p_company":"co","p_periods":["2026-09"],"p_filename":"Odoo"}');
    expect(log[1]).toContain("rpc add_stock_ledger_lines");
  });
});
