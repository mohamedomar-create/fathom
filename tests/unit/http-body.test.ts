// Request bodies are read with a hard size cap, counted as the bytes arrive: a body sent in chunks (with no length
// header) can't get past it, and nothing over the cap is parsed.
import { describe, expect, it } from "vitest";
import { readJsonCapped } from "@/lib/http/body";

const chunked = (parts: string[]) => new Request("http://x/", { method: "POST", body: new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } }), duplex: "half" } as RequestInit);

describe("a capped request body", () => {
  it("is parsed when it fits", async () => expect(await readJsonCapped(chunked(['{"a":', "1}"]), 100)).toEqual({ ok: true, value: { a: 1 } }));
  it("is refused when chunks add up past the cap, with no length header", async () => expect(await readJsonCapped(chunked(["x".repeat(60), "y".repeat(60)]), 100)).toEqual({ ok: false, reason: "too_large" }));
  it("is refused at once when the declared length is over the cap", async () => {
    const r = new Request("http://x/", { method: "POST", body: "{}", headers: { "content-length": "5000" } });
    expect(await readJsonCapped(r, 100)).toEqual({ ok: false, reason: "too_large" });
  });
  it("says when the body is not JSON", async () => expect(await readJsonCapped(chunked(["{nope"]), 100)).toEqual({ ok: false, reason: "invalid" }));
});
