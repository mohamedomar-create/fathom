import { describe, expect, it } from "vitest";
import { handOffOutcome } from "@/lib/imports/handoff";

describe("D25: the page sends rows itself only when the server could not be reached or failed", () => {
  it("202: the server took over", () => expect(handOffOutcome(202, {})).toEqual({ by: "server" }));
  it("a server error (5xx): the page sends the rows", () => {
    expect(handOffOutcome(500, {})).toEqual({ by: "page" });
    expect(handOffOutcome(504, {})).toEqual({ by: "page" });
  });
  it("no answer at all (network): the page sends the rows", () => expect(handOffOutcome(null, null)).toEqual({ by: "page" }));
  it("the server could not read the stored file (422, not preflight): the page sends the rows", () => {
    expect(handOffOutcome(422, { error: "The stored file could not be read: missing" })).toEqual({ by: "page" });
  });
  it("preflight refused the file: nobody sends its rows", () => {
    expect(handOffOutcome(422, { error: "PREFLIGHT: no amount column" })).toEqual({ refused: "PREFLIGHT: no amount column" });
  });
  it("a refusal (signed out, not allowed, import closed) stops the page too", () => {
    expect(handOffOutcome(401, { error: "Please sign in" })).toEqual({ refused: "Please sign in" });
    expect(handOffOutcome(409, { error: "This import is no longer open." })).toEqual({ refused: "This import is no longer open." });
    expect(handOffOutcome(403, {})).toEqual({ refused: "The server refused this import (403)." });
  });
});
