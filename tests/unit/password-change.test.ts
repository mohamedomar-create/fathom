import { describe, expect, it, vi } from "vitest";
import { changePasswordWith, type PasswordDeps } from "@/lib/auth/password-change";

function deps(over: Partial<PasswordDeps> = {}): PasswordDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    limited: vi.fn(async () => { calls.push("limit"); return false; }),
    verify: vi.fn(async () => { calls.push("verify"); return true; }),
    update: vi.fn(async () => { calls.push("update"); return null; }),
    signOutOthers: vi.fn(async () => { calls.push("signout"); }),
    ...over,
  };
}
const ok = { current: "old-password-1", next: "new-password-22" };

describe("changing the password", () => {
  it("checks the rate limit before testing the current password", async () => {
    const d = deps({ limited: vi.fn(async () => true) });
    const r = await changePasswordWith(d, "a@x.test", ok.current, ok.next);
    expect(r.ok).toBe(false);
    expect(d.verify).not.toHaveBeenCalled();
  });
  it("refuses a wrong current password without changing anything", async () => {
    const d = deps({ verify: vi.fn(async () => false) });
    const r = await changePasswordWith(d, "a@x.test", ok.current, ok.next);
    expect(r).toEqual({ ok: false, error: "The current password is not right." });
    expect(d.update).not.toHaveBeenCalled();
  });
  it("never passes the auth service's own error text to the person", async () => {
    const d = deps({ update: vi.fn(async () => "AuthApiError: weak_password detail xyz") });
    const r = await changePasswordWith(d, "a@x.test", ok.current, ok.next);
    expect(r.ok).toBe(false);
    expect("error" in r ? r.error : "").not.toMatch(/AuthApiError|xyz/);
  });
  it("changes it and signs out the other devices, in that order", async () => {
    const d = deps();
    expect(await changePasswordWith(d, "a@x.test", ok.current, ok.next)).toEqual({ ok: true });
    expect(d.calls).toEqual(["limit", "verify", "update", "signout"]);
  });
  it("refuses the same password before checking it", async () => {
    const d = deps();
    const r = await changePasswordWith(d, "a@x.test", ok.current, ok.current);
    expect(r.ok).toBe(false);
    expect(d.verify).not.toHaveBeenCalled();
  });
});
