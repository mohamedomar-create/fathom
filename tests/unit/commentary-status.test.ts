import { describe, expect, it } from "vitest";
import { CommentaryError, commentaryStatus } from "@/lib/ai/commentary-error";

describe("commentary error status", () => {
  it("not switched on is 'unavailable' (503), not a gateway failure", () => expect(commentaryStatus(new CommentaryError("x", "not_configured"))).toBe(503));
  it("a failure of the AI service stays a gateway error (502)", () => expect(commentaryStatus(new CommentaryError("x"))).toBe(502));
});

describe("commentary refuses figures it can't trust (O8)", () => {
  it("a failed read and a module still being added up with nothing to show are both refused; a rebuild with a previous copy is not", async () => {
    const { commentaryRefusal } = await import("@/lib/ai/commentary-guard");
    expect(commentaryRefusal([{ status: "failed", empty: true, ref: "R1" }, { status: "ready", empty: false }])).toMatch(/couldn't be read just now \(ref R1\)/);
    expect(commentaryRefusal([{ status: "ready", empty: false }, { status: "pending", empty: true }])).toMatch(/still being added up/);
    expect(commentaryRefusal([{ status: "pending", empty: false }, { status: "stale", empty: false }])).toBeNull();
    expect(commentaryRefusal([{ status: "empty", empty: true }, { status: "ready", empty: false }])).toBeNull();
  });
});
