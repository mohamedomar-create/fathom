import { describe, expect, it } from "vitest";
import { lastSignIn, signedInRecently } from "@/lib/auth/recent";
import { codeStillNeeded } from "@/lib/auth/levels";
import { idleState, IDLE_MS, WARN_MS, seenIsStale, seenAction, heartbeatDue, HEARTBEAT_MS, SEEN_MAX_AGE_S } from "@/lib/auth/idle";

describe("a fresh sign-in before destructive actions", () => {
  const claims = { amr: [{ method: "password", timestamp: 1000 }, { method: "totp", timestamp: 1100 }] };
  it("only a password (or email link) counts; a two-step code alone does not", () => expect(lastSignIn(claims)).toBe(1000));
  it("within 5 minutes of the password is recent, after is not", () => {
    expect(signedInRecently(claims, 1000 + 300)).toBe(true);
    expect(signedInRecently(claims, 1000 + 301)).toBe(false);
  });
  it("a session that only ever entered a code is never recent", () => expect(signedInRecently({ amr: [{ method: "totp", timestamp: 50 }] }, 60)).toBe(false));
  it("email links and recovery count", () => {
    for (const method of ["otp", "magiclink", "recovery"]) expect(lastSignIn({ amr: [{ method, timestamp: 7 }] })).toBe(7);
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

describe("the server's last-seen stamp", () => {
  const now = 10_000_000;
  it("a signed-in request with a stale stamp is signed out; a fresh one is refreshed", () => {
    expect(seenAction(true, String(now - IDLE_MS - 1), now)).toBe("signout");
    expect(seenAction(true, String(now - 1000), now)).toBe("refresh");
    expect(seenAction(true, undefined, now)).toBe("refresh");
  });
  it("a signed-out request clears a stamp left behind, so the next sign-in starts fresh", () => {
    expect(seenAction(false, String(now - IDLE_MS - 1), now)).toBe("clear");
    expect(seenAction(false, undefined, now)).toBe("none");
  });
  it("the stamp outlives closing the browser", () => expect(SEEN_MAX_AGE_S).toBeGreaterThanOrEqual(7 * 24 * 3600));
  it("an active page tells the server at most every 5 minutes", () => {
    expect(HEARTBEAT_MS).toBe(5 * 60_000);
    expect(heartbeatDue(0, HEARTBEAT_MS - 1)).toBe(false);
    expect(heartbeatDue(0, HEARTBEAT_MS)).toBe(true);
  });
});

describe("two-step sign-in on every page", () => {
  it("a session with a factor that entered only the password is sent to the code step", () => {
    expect(codeStillNeeded({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
    expect(codeStillNeeded({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
    expect(codeStillNeeded({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
    expect(codeStillNeeded(null)).toBe(false);
  });
});
