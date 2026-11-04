// A company page's data arrives in as few rounds to the database as possible: every read that doesn't need another's
// answer goes at the same time. Each round costs a full trip to the database, so rounds, not reads, set the wait.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// One request: React's per-request cache, as on the server (outside a server render it would not remember).
const memo = new Map<unknown, Map<string, unknown>>();
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => {
  const m = memo.get(fn) ?? new Map<string, unknown>(); memo.set(fn, m);
  const k = JSON.stringify(a);
  if (!m.has(k)) m.set(k, fn(...a));
  return m.get(k) as R;
} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));

const ID = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const company = { id: ID, org_id: ORG, name: "Wave Co", data_version: 1, source: "upload", kpi_config: {}, currency: "EGP", fy_start_month: 1, tax_rate: 0.225, last_synced_at: null, notes: [], closed_through: null };

/** A fake database: each read starts in the current round; a round ends when one of its reads answers. */
let round = 0;
let started: { what: string; round: number }[] = [];
function answer(table: string, sel: string, single: boolean): unknown {
  if (table === "companies") return single ? company : [{ id: ID, name: "Wave Co" }];
  if (table === "memberships") return single ? { role: "admin", org_id: ORG } : [{ role: "admin", org_id: ORG }];
  if (table === "organizations") return { name: "Wave Org" };
  return single ? null : [];
}
function builder(table: string) {
  let sel = "", single = false;
  const b: Record<string, unknown> = {};
  for (const m of ["eq", "neq", "order", "limit", "not", "in", "gte", "lte", "is"]) b[m] = () => b;
  b.select = (s: string) => { sel = s; return b; };
  b.maybeSingle = () => { single = true; return b; };
  b.single = () => { single = true; return b; };
  b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
    started.push({ what: `${table}:${sel}`, round });
    return new Promise((r) => setTimeout(r, 5)).then(() => { round++; return { data: answer(table, sel, single), error: null }; }).then(ok, bad);
  };
  return b;
}
const client = {
  from: (t: string) => builder(t),
  rpc: (name: string, args?: { p_company?: string }) => ({ then: (ok: (v: unknown) => unknown) => { started.push({ what: `rpc:${name}`, round }); return new Promise((r) => setTimeout(r, 5)).then(() => { round++; return { data: name === "my_company_role" ? (args?.p_company === company.id && company.org_id === ORG ? "admin" : null) : [], error: null }; }).then(ok); } }),
};
vi.mock("@/lib/supabase/server", () => ({ getUser: async () => ({ supabase: client, user: { id: USER, email: "w@x.test" } }) }));

const { loadCompanyMeta } = await import("@/lib/company/meta");
const { loadCompanyBundle } = await import("@/lib/company/load");

/** How many rounds the reads took: reads that start before any earlier read has answered share a round. */
const rounds = () => new Set(started.map((s) => s.round)).size;

describe("company page loads", () => {
  beforeEach(() => { round = 0; started = []; memo.clear(); });

  it("who the person is in the company takes one round (the company and the membership read together)", async () => {
    const meta = await loadCompanyMeta(ID);
    expect(meta).toMatchObject({ id: ID, orgId: ORG, role: "admin", dataVersion: 1 });
    expect(rounds()).toBe(1);
  });

  it("the whole company (as the page layout loads it: who, then everything) takes two rounds in all", async () => {
    await loadCompanyMeta(ID);
    const b = await loadCompanyBundle(ID);
    expect(b).toMatchObject({ id: ID, name: "Wave Co", role: "admin", orgName: "Wave Org" });
    expect(rounds()).toBeLessThanOrEqual(2);
  });

  it("a person with no membership in the company's organisation gets not found", async () => {
    const other = { ...company, org_id: "44444444-4444-4444-8444-444444444444", id: "55555555-5555-4555-8555-555555555555" };
    const saved = company.org_id;
    Object.assign(company, other);
    await expect(loadCompanyMeta(other.id)).rejects.toThrow("NOT_FOUND");
    Object.assign(company, { org_id: saved, id: ID });
  });
});
