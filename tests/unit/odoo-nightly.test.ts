// The nightly Odoo sync (3c): the same steps as a person's Sync now, run on the server through the database's job
// functions (0046). It only calls the allowlisted save functions, only for its own company, and the route answers only
// to the CRON_SECRET.
import { describe, expect, it } from "vitest";
import { OdooClient } from "@/lib/odoo/client";
import { cronAuthorized, nightlyStep, runNightly, type NightlyCtx, type NightStep } from "@/lib/odoo/nightly";
import { fakeOdoo } from "../fixtures/fake-odoo";

const CO = "11111111-1111-4111-8111-111111111111";
const ALLOWED = new Set(["save_company_version", "update_company_settings", "company_balances", "stage_lines_begin", "stage_lines_add", "stage_lines_finish",
  "stage_lines_cancel", "begin_stock_ledger_batch", "add_stock_ledger_lines", "begin_inventory_batch", "add_stock_moves", "add_stock_layers",
  "finish_inventory_batch", "set_stock_onhand"]);

function recorder() {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let n = 0;
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push({ fn, args });
    switch (fn) {
      case "save_company_version": return { version: 7, import_id: id() };
      case "stage_lines_begin": case "begin_stock_ledger_batch": case "begin_inventory_batch": return id();
      case "stage_lines_add": case "add_stock_ledger_lines": case "set_stock_onhand": { const x = (args.p_lines ?? args.p_rows) as unknown[] | undefined; return Array.isArray(x) ? x.length : 0; }
      case "company_balances": return [];
      default: return {};
    }
  };
  return { calls, rpc };
}

const ctx = (over: Partial<NightlyCtx["company"]> = {}): NightlyCtx => ({
  company_id: CO,
  connection: { url: "https://x.odoo.com", db: "db", login: "me@x.com", api_key_enc: "v2.x.y.z", odoo_company_id: 1, odoo_company_name: "X", include_branches: false, months_history: 25 },
  company: { kpi_config: { profile: { booksStart: "2021-07-01" } }, closed_through: null, data_version: 0, ...over },
  last_import: null, account_map: [], accounts: [],
});
const client = () => new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", fakeOdoo(18).fetch);

describe("the nightly steps", () => {
  it("balances first, saved as a new version for its own company, then the detail parts in order", async () => {
    const r = recorder();
    const first = await nightlyStep(r.rpc, ctx(), client(), { part: "balances" });
    const save = r.calls.find((c) => c.fn === "save_company_version")!;
    expect(save.args.p_company).toBe(CO);
    expect((save.args.p_import as { kind: string }).kind).toBe("odoo");
    expect(first.next?.part).toBe("ledger");
    expect(first.next && "accts" in first.next && first.next.accts?.length).toBeGreaterThan(0);
  });

  it("a whole run walks every part, ends with nothing next, and calls only allowlisted functions for its own company", async () => {
    const r = recorder();
    const out = await runNightly(r.rpc, ctx(), client(), { part: "balances" }, Date.now() + 60_000);
    expect(out.next).toBeNull();
    expect(out.ok).toBe(true);
    const fns = [...new Set(r.calls.map((c) => c.fn))];
    for (const f of fns) expect(ALLOWED.has(f)).toBe(true);
    for (const c of r.calls) if ("p_company" in c.args) expect(c.args.p_company).toBe(CO);
    expect(fns).toEqual(expect.arrayContaining(["save_company_version", "stage_lines_begin", "stage_lines_add", "stage_lines_finish", "begin_stock_ledger_batch",
      "begin_inventory_batch", "add_stock_moves", "add_stock_layers", "finish_inventory_batch", "set_stock_onhand"]));
  });

  it("stops at the deadline and hands back where to carry on", async () => {
    const r = recorder();
    const out = await runNightly(r.rpc, ctx(), client(), { part: "balances" }, Date.now() - 1);
    expect(out.next).toEqual({ part: "balances" });
    expect(r.calls).toEqual([]);
  });

  it("an unbalanced or empty answer from Odoo saves nothing and fails the run", async () => {
    const r = recorder();
    const other = ctx();
    other.connection.odoo_company_id = 999;
    const out = await runNightly(r.rpc, other, client(), { part: "balances" }, Date.now() + 30_000);
    expect(out.ok).toBe(false);
    expect(r.calls.some((c) => c.fn === "save_company_version")).toBe(false);
  });

  it("closed months keep their stored figures (stock lines in closed months are not sent)", async () => {
    const r = recorder();
    const step: NightStep = { part: "balances" };
    await runNightly(r.rpc, ctx({ closed_through: "2026-12" }), client(), step, Date.now() + 60_000);
    const stock = r.calls.filter((c) => c.fn === "add_stock_ledger_lines" || c.fn === "add_stock_moves" || c.fn === "add_stock_layers");
    expect(stock).toEqual([]);
    expect(r.calls.some((c) => c.fn === "stage_lines_begin")).toBe(false);
    expect(r.calls.find((c) => c.fn === "company_balances")?.args).toEqual({ p_company: CO, p_version: 0 });
  });
});

describe("the cron route's check", () => {
  it("only the exact bearer secret passes; a missing or short secret never does", () => {
    const s = "ab".repeat(32);
    expect(cronAuthorized(`Bearer ${s}`, s)).toBe(true);
    expect(cronAuthorized(`Bearer ${s}x`, s)).toBe(false);
    expect(cronAuthorized(s, s)).toBe(false);
    expect(cronAuthorized(null, s)).toBe(false);
    expect(cronAuthorized("Bearer ", "")).toBe(false);
    expect(cronAuthorized("Bearer short", "short")).toBe(false);
  });
});
