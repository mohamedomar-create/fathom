import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { limited, checkLimit } from "@/lib/rate-limit";
import { scrubEvent } from "@/lib/report-error";
import { healthAnswer, REQUIRED_SCHEMA, schemaBehind, resetSchemaCache } from "@/lib/schema";
import { aiCostMicros } from "@/lib/ai/budget";

const fake = (result: { data?: unknown; error?: { code?: string; message: string } }) => ({ rpc: async () => result }) as never;

describe("rate limits fail closed", () => {
  it("a database error counts as over the limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await limited(fake({ error: { code: "57014", message: "timeout" } }), "export", "u")).toBe(true);
  });
  it("a missing limit function is an error too, never an open door", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await limited(fake({ error: { code: "PGRST202", message: "Could not find rate_limit_hit" } }), "export", "u")).toBe(true);
  });
  it("within the limit passes", async () => expect(await limited(fake({ data: true }), "export", "u")).toBe(false));
  it("a check that could not be made is told apart from a limit reached", async () => {
    expect(await checkLimit(fake({ error: { code: "57014", message: "timeout" } }), "export", "u")).toBe("error");
    expect(await checkLimit(fake({ data: false }), "export", "u")).toBe("over");
    expect(await checkLimit(fake({ data: true }), "export", "u")).toBe("ok");
  });
});

describe("error reports carry no company data", () => {
  it("emails, long numbers, cookies and query strings are removed", () => {
    const e = scrubEvent({
      message: "Upload for nadia@firm.com failed at 1234567.89 EGP",
      request: { url: "https://app/x?token=abc&company=1", cookies: "sb=secret", data: "{amount: 5}", headers: { cookie: "sb=1", "user-agent": "UA" } },
      user: { email: "nadia@firm.com", id: "u1" },
    });
    expect(e.message).toBe("Upload for [email] failed at [number] EGP");
    expect(e.request).toEqual({ url: "https://app/x", headers: { "user-agent": "UA" } });
    expect(e.user).toEqual({ id: "u1" });
  });
  it("small amounts, grouped phone numbers, quoted names and database key values are removed too", () => {
    expect(scrubEvent({ message: "Total 1,234 vs 12.50, call +20 100 123 4567" }).message).toBe("Total [number] vs [number], call +[number] [number] [number] [number]");
    expect(scrubEvent({ message: 'duplicate key: Key (company_id, name)=(1f2e, Acme Trading) already exists' }).message).toBe("duplicate key: Key (company_id, name)=([value]) already exists");
    expect(scrubEvent({ message: `account "Cash at Bank" and 'شركة النور' not found` }).message).toBe("account [text] and [text] not found");
  });
});

describe("the health answer", () => {
  it("ok when the database answers at the version the app needs", () => {
    expect(healthAnswer({ db: true, schema: REQUIRED_SCHEMA })).toMatchObject({ status: 200, body: { ok: true, schema: REQUIRED_SCHEMA } });
  });
  it("503 naming the update when the database is behind, or unreachable", () => {
    expect(healthAnswer({ db: true, schema: REQUIRED_SCHEMA - 1 })).toMatchObject({ status: 503, body: { ok: false, problem: `database needs update ${REQUIRED_SCHEMA}` } });
    expect(healthAnswer({ db: false, schema: null })).toMatchObject({ status: 503, body: { ok: false, problem: "database unreachable" } });
  });
});

describe("pages stop when the database is behind the app", () => {
  it("an older database names the update it needs", async () => {
    resetSchemaCache();
    expect(await schemaBehind(fake({ data: REQUIRED_SCHEMA - 1 }))).toBe(REQUIRED_SCHEMA);
    resetSchemaCache();
    expect(await schemaBehind(fake({ error: { code: "PGRST202", message: "no function" } }))).toBe(REQUIRED_SCHEMA);
  });
  it("a database at the version passes, and a passing hiccup never blocks the pages", async () => {
    resetSchemaCache();
    expect(await schemaBehind(fake({ data: REQUIRED_SCHEMA }))).toBeNull();
    resetSchemaCache();
    expect(await schemaBehind(fake({ error: { code: "57014", message: "timeout" } }))).toBeNull();
  });
});

describe("AI spend is counted from the reply's token use", () => {
  it("input and output tokens at the model's price, in millionths of a dollar", () => {
    // Opus 5.5: $4 in, $20 out, cache reads $0.20, cache writes $5 per million tokens.
    expect(aiCostMicros({ input_tokens: 1_000_000, output_tokens: 0 })).toBe(4_000_000);
    expect(aiCostMicros({ input_tokens: 0, output_tokens: 1_000_000 })).toBe(20_000_000);
    expect(aiCostMicros({ input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 1000 })).toBe(2000 * 4 + 1000 * 20 + 10_000 * 0.2 + 1000 * 5);
  });
});
