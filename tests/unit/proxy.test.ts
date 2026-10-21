import { describe, expect, it } from "vitest";
import { keepsOwnAnswer } from "@/proxy";

const req = (method: string, path: string, headers: Record<string, string> = {}) => ({ method, headers: new Headers(headers), nextUrl: new URL(`http://x${path}`) }) as Parameters<typeof keepsOwnAnswer>[0];

describe("signed-out requests the proxy must not redirect", () => {
  it("a form's Save (server action) answers for itself", () => expect(keepsOwnAnswer(req("POST", "/company/x/settings/profile", { "Next-Action": "abc" }))).toBe(true));
  it("the API answers for itself", () => expect(keepsOwnAnswer(req("GET", "/api/export/x"))).toBe(true));
  it("opening a page still goes to sign-in", () => expect(keepsOwnAnswer(req("GET", "/company/x/summary"))).toBe(false));
  it("a plain POST without the action header still goes to sign-in", () => expect(keepsOwnAnswer(req("POST", "/company/x/summary"))).toBe(false));
});

import { hasSessionCookie } from "@/components/shell/session-watch";
describe("the session cookie", () => {
  it("is seen whole or split", () => {
    expect(hasSessionCookie("a=1; sb-abc-auth-token=base64-xyz")).toBe(true);
    expect(hasSessionCookie("sb-abc-auth-token.0=base64-xy; sb-abc-auth-token.1=z")).toBe(true);
  });
  it("is gone after sign-out or expiry", () => {
    expect(hasSessionCookie("")).toBe(false);
    expect(hasSessionCookie("lang=ar; sb-abc-auth-token-code-verifier=x")).toBe(false);
  });
});

import { malformedId } from "@/proxy";
describe("addresses whose ids can't be ids", () => {
  const id = "1c8c55b3-4c99-4511-9948-9f6a0b5e94f0";
  it("are caught", () => {
    for (const p of ["/company/not-a-uuid/summary", `/company/${"9".repeat(300)}`, `/company/${id}/reports/not-a-uuid`]) expect(malformedId(p), p).toBe(true);
  });
  it("real ones and other pages pass", () => {
    for (const p of [`/company/${id}/summary`, `/company/${id}/reports`, `/company/${id}/reports/${id}`, "/companies", "/company"]) expect(malformedId(p), p).toBe(false);
  });
});
