import { describe, expect, it } from "vitest";
import { lastSignIn, signedInRecently } from "@/lib/auth/recent";
import { idleState, IDLE_MS, WARN_MS, seenIsStale } from "@/lib/auth/idle";

describe("a fresh sign-in before destructive actions", () => {
  const claims = { amr: [{ method: "password", timestamp: 1000 }, { method: "totp", timestamp: 1100 }] };
  it("the latest sign-in step counts", () => expect(lastSignIn(claims)).toBe(1100));
  it("within 5 minutes is recent, after is not", () => {
    expect(signedInRecently(claims, 1100 + 300)).toBe(true);
    expect(signedInRecently(claims, 1100 + 301)).toBe(false);
  });
  it("no sign-in record is never recent", () => expect(signedInRecently({}, 10)).toBe(false));
});

describe("signed out after 30 minutes without activity", () => {
  it("active, then a warning 2 minutes before, then out", () => {
    expect(idleState(0, IDLE_MS - WARN_MS - 1)).toBe("active");
    expect(idleState(0, IDLE_MS - WARN_MS)).toBe("warn");
    expect(idleState(0, IDLE_MS)).toBe("out");
  });
  it("the server's last-seen stamp is stale after 30 minutes, and a missing or broken one is not", () => {
    expect(seenIsStale(String(1_000_000), 1_000_000 + IDLE_MS + 1)).toBe(true);
    expect(seenIsStale(String(1_000_000), 1_000_000 + IDLE_MS - 1)).toBe(false);
    expect(seenIsStale(undefined, 5)).toBe(false);
    expect(seenIsStale("x", 5)).toBe(false);
  });
});
