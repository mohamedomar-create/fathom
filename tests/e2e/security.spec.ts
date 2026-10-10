import { expect, test } from "@playwright/test";

test("every page is served with the security headers", async ({ request }) => {
  for (const path of ["/", "/login", "/demo/summary"]) {
    const res = await request.get(path);
    const h = res.headers();
    expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"], path).toContain("object-src 'none'");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"], path).toContain("max-age=");
    expect(h["x-powered-by"], path).toBeUndefined();
  }
});

test("the sign-in callback never sends people to another site", async ({ request, baseURL }) => {
  for (const next of ["/\\evil.com", "//evil.com", "https://evil.com"]) {
    const res = await request.get(`/auth/callback?next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
    const loc = res.headers()["location"] ?? "";
    expect(new URL(loc, baseURL).origin, next).toBe(new URL(baseURL!).origin);
  }
});

test("the PDF engine is not open to the public", async ({ request }) => {
  expect((await request.get("/api/pdf-smoke")).status()).toBe(404);
  const res = await request.post("/api/pdf", { data: { html: "<p>hello world</p>", css: "" } });
  expect(res.status()).toBe(401);
});
