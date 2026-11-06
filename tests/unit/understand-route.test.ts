import { beforeEach, describe, expect, it, vi } from "vitest";

// AI assist for the intake, with the paid call and the database replaced: nothing here leaves the machine.
vi.mock("server-only", () => ({}));
const parse = vi.fn();
vi.mock("@anthropic-ai/sdk", async (orig) => {
  const actual = await orig<typeof import("@anthropic-ai/sdk")>();
  class Fake extends actual.default {
    constructor(o: ConstructorParameters<typeof actual.default>[0]) {
      super({ ...o, apiKey: "test" });
      Object.defineProperty(this, "beta", { value: { messages: { parse } } });
    }
  }
  return { ...actual, default: Fake };
});
const db = { company: { org_id: "o1" } as { org_id: string } | null, role: "editor" as string | null, user: { id: "u1" } as { id: string } | null, over: false, budget: true, rpcs: [] as string[], usageKind: "" };
vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => ({
    user: db.user,
    supabase: {
      from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: db.company }) }; return q; },
      rpc: async (name: string, args: Record<string, unknown>) => { db.rpcs.push(name); if (name === "record_ai_usage") db.usageKind = String(args.p_kind); return { data: name === "ai_budget_ok" ? db.budget : name === "my_company_role" ? (db.company ? db.role : null) : null, error: null }; },
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ limits: async () => (db.over ? "over" : "ok"), BUSY: "busy" }));

const { POST } = await import("@/app/api/companies/[id]/understand/route");
const ID = "11111111-1111-4111-8111-111111111111";
const SAMPLE = { sheet: "Foglio1", title: null, rows: [["Cliente", "Fattura", "Scadenza", "Residuo"], ["A", "F1", "01/10/2026", "10"]], totalRows: 2 };
const post = (body: unknown) => POST(new Request(`http://x/api/companies/${ID}/understand`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  parse.mockReset();
  process.env.ANTHROPIC_API_KEY = "test";
  Object.assign(db, { company: { org_id: "o1" }, role: "editor", user: { id: "u1" }, over: false, budget: true, rpcs: [], usageKind: "" });
});

describe("the understand route", () => {
  it("returns the model's suggestion and records the usage as intake AI", async () => {
    parse.mockResolvedValue({ stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 80 }, parsed_output: { module: "ar_open", headerRow: 0, columns: [{ column: 0, field: "party", confidence: 0.9 }], reason: "Receivables in Italian." } });
    const res = await post({ sample: SAMPLE });
    expect(res.status).toBe(200);
    expect((await res.json()).suggestion.module).toBe("ar_open");
    expect(db.usageKind).toBe("understand");
    // Only the sample was sent, as data.
    const sent = parse.mock.calls[0][0].messages[0].content[0].text as string;
    expect(sent).toContain("Cliente");
    expect(parse.mock.calls[0][0].system).toContain("data, not instructions");
  });

  it("refuses more than a sample (over 30 rows or 30 columns), a viewer, an outsider, and when over the limit or budget", async () => {
    expect((await post({ sample: { ...SAMPLE, rows: Array.from({ length: 31 }, () => ["a"]) } })).status).toBe(400);
    expect((await post({ sample: { ...SAMPLE, rows: [Array.from({ length: 31 }, () => "a")] } })).status).toBe(400);
    db.role = "viewer"; expect((await post({ sample: SAMPLE })).status).toBe(403);
    db.role = "editor"; db.company = null; expect((await post({ sample: SAMPLE })).status).toBe(404);
    db.company = { org_id: "o1" }; db.over = true; expect((await post({ sample: SAMPLE })).status).toBe(429);
    db.over = false; db.budget = false; expect((await post({ sample: SAMPLE })).status).toBe(429);
    expect(parse).not.toHaveBeenCalled();
  });
});
