import { describe, expect, it, vi } from "vitest";
import { safeNext } from "@/lib/safe-redirect";
import { DbError, dbError, safeError } from "@/lib/action-error";
import { z } from "zod";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/company/abc/summary?x=1")).toBe("/company/abc/summary?x=1");
    expect(safeNext("/auth/reset")).toBe("/auth/reset");
  });
  it("refuses anything that leaves the site", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "\\\\evil.com", "/%5Cevil.com", "/%2F/evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "/\tevil", "", null, undefined])
      expect(safeNext(bad as string), String(bad)).toBe("/companies");
  });
  it("uses the given fallback", () => expect(safeNext("//x", "/auth/reset")).toBe("/auth/reset"));
});

describe("safe errors", () => {
  it("maps database errors to plain sentences and hides the rest behind a reference", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(dbError({ code: "42501", message: 'new row violates row-level security policy for table "memberships"' }, "t")).toBe("You don't have permission to do that.");
    const msg = dbError({ code: "XX000", message: 'relation "private.secret" does not exist' }, "t");
    expect(msg).toMatch(/^Something went wrong \(ref [0-9A-F]{6}\)/);
    expect(msg).not.toMatch(/relation|private/);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
  it("passes through our own messages and readable SQL exceptions", async () => {
    expect(safeError(new Error("Enter the API key."), "t")).toBe("Enter the API key.");
    expect(dbError({ code: "P0001", message: "an organisation needs at least one admin" }, "t")).toBe("An organisation needs at least one admin.");
    expect(dbError({ code: "42501", message: "x", hint: "mfa_required" }, "t")).toBe("Turn on two-step sign-in (Account, Security) to do this.");
    // A time-out or a lock wait says "busy" (the chunk engine splits and retries on it), never a generic error.
    const { isBusy } = await import("@/lib/chunks");
    for (const code of ["57014", "55P03"]) expect(isBusy(new Error(dbError({ code, message: "canceling statement due to statement timeout" }, "t")))).toBe(true);
    expect(safeError(new DbError({ code: "42501", message: "rls" }), "t")).toBe("You don't have permission to do that.");
    const z1 = z.string().uuid().safeParse("x");
    expect(safeError(z1.error, "t")).toMatch(/^That value isn't valid/);
  });
});
