import { describe, expect, it } from "vitest";
import { CommentaryError, commentaryStatus } from "@/lib/ai/commentary-error";

describe("commentary error status", () => {
  it("not switched on is 'unavailable' (503), not a gateway failure", () => expect(commentaryStatus(new CommentaryError("x", "not_configured"))).toBe(503));
  it("a failure of the AI service stays a gateway error (502)", () => expect(commentaryStatus(new CommentaryError("x"))).toBe(502));
});
