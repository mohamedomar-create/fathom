import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

// The reader and the route, with the paid Claude call and the database replaced: nothing here leaves the machine.
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
const db = { company: { org_id: "o1" } as { org_id: string } | null, role: "editor" as string | null, user: { id: "u1" } as { id: string } | null, over: false, busy: false, budget: true, rpcs: [] as string[] };
vi.mock("@/lib/supabase/server", () => ({
  getUser: async () => ({
    user: db.user,
    supabase: {
      from: (t: string) => {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: t === "companies" ? db.company : db.role ? { role: db.role } : null }) };
        return q;
      },
      rpc: async (name: string) => { db.rpcs.push(name); return { data: name === "ai_budget_ok" ? db.budget : null, error: null }; },
    },
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ limits: async () => (db.busy ? "error" : db.over ? "over" : "ok"), BUSY: "The service is busy just now. Please try again in a minute." }));

const { readPage, ReadError } = await import("@/lib/ai/read-page");
const { POST } = await import("@/app/api/companies/[id]/read-page/route");
const Anthropic = (await import("@anthropic-ai/sdk")).default;

const PAGE = { kind: "pl", title: "P&L", company: "", currency: "EGP", scale: "units", dateText: "", columns: ["2025"], rows: [{ code: "", label: "Revenue", values: [100], total: false, heading: false, unclear: false }] };
const ok = (out: unknown = PAGE) => ({ stop_reason: "end_turn", parsed_output: out });
const ID = "11111111-1111-4111-8111-111111111111";

async function onePagePdf(pages = 1) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([200, 200]);
  return d.save();
}
async function post(body: Uint8Array | null, check?: unknown) {
  const form = new FormData();
  if (body) form.append("page", new Blob([body as BlobPart]), "page.pdf");
  if (check !== undefined) form.append("check", JSON.stringify(check));
  return POST(new Request(`http://x/api/companies/${ID}/read-page`, { method: "POST", body: form }), { params: Promise.resolve({ id: ID }) });
}

beforeEach(() => {
  parse.mockReset();
  process.env.ANTHROPIC_API_KEY = "test";
  Object.assign(db, { company: { org_id: "o1" }, role: "editor", user: { id: "u1" }, over: false, busy: false, budget: true, rpcs: [] });
});

describe("the page reader", () => {
  it("sends a PDF page as a document and a scan as an image, with the structured answer format", async () => {
    parse.mockResolvedValue(ok());
    expect(await readPage({ data: "AAA", type: "pdf" })).toEqual(PAGE);
    const req = parse.mock.calls[0][0];
    expect(req.messages[0].content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "AAA" } });
    expect(req.output_config.format).toBeTruthy();
    expect(req.system).toContain("Never calculate");
    await readPage({ data: "BBB", type: "jpeg" });
    expect(parse.mock.calls[1][0].messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg" } });
  });

  it("a second look names the rows that did not add up, without passing markup through", async () => {
    parse.mockResolvedValue(ok());
    await readPage({ data: "AAA", type: "pdf" }, ["“Total assets” reads 100 <b>x</b>"]);
    const text = parse.mock.calls[0][0].messages[0].content[1].text as string;
    expect(text).toContain("Total assets");
    expect(text).not.toContain("<b>");
  });

  it("explains a missing key, a refusal, a page too long and a busy service in plain words", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(readPage({ data: "A", type: "pdf" })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    process.env.ANTHROPIC_API_KEY = "test";
    parse.mockResolvedValueOnce({ stop_reason: "refusal", parsed_output: null });
    await expect(readPage({ data: "A", type: "pdf" })).rejects.toBeInstanceOf(ReadError);
    parse.mockResolvedValueOnce({ stop_reason: "max_tokens", parsed_output: null });
    await expect(readPage({ data: "A", type: "pdf" })).rejects.toThrow(/too much/);
    parse.mockRejectedValueOnce(Object.create(Anthropic.RateLimitError.prototype));
    await expect(readPage({ data: "A", type: "pdf" })).rejects.toThrow(/busy/);
  });
});

describe("the read-page route", () => {
  it("reads one page for an editor and records what the reading used", async () => {
    parse.mockResolvedValue({ ...ok(), usage: { input_tokens: 1000, output_tokens: 100 } });
    const res = await post(await onePagePdf());
    expect(res.status).toBe(200);
    expect((await res.json()).read).toEqual(PAGE);
    expect(db.rpcs).toEqual(["ai_budget_ok", "record_ai_usage"]);
  });

  it("when the limit cannot be checked, it says try again in a minute, not tomorrow", async () => {
    db.busy = true;
    const res = await post(await onePagePdf());
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("try again in a minute");
    expect(parse).not.toHaveBeenCalled();
  });

  it("an organisation over its AI allowance is told so, and nothing is read", async () => {
    db.budget = false;
    const res = await post(await onePagePdf());
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain("allowance");
    expect(parse).not.toHaveBeenCalled();
  });

  it("refuses visitors, viewers and other organisations' companies before anything is read", async () => {
    db.user = null;
    expect((await post(await onePagePdf())).status).toBe(401);
    db.user = { id: "u1" }; db.role = "viewer";
    expect((await post(await onePagePdf())).status).toBe(403);
    db.role = null;
    expect((await post(await onePagePdf())).status).toBe(403);
    db.company = null;
    expect((await post(await onePagePdf())).status).toBe(404);
    expect(parse).not.toHaveBeenCalled();
  });

  it("takes one page at a time, PDF or JPEG only, and stops at the daily limit", async () => {
    expect((await post(await onePagePdf(2))).status).toBe(400);
    expect((await post(new TextEncoder().encode("hello"))).status).toBe(400);
    expect((await post(null)).status).toBe(400);
    expect((await post(await onePagePdf(), "not a list")).status).toBe(400);
    db.over = true;
    expect((await post(await onePagePdf())).status).toBe(429);
    expect(parse).not.toHaveBeenCalled();
  });
});
