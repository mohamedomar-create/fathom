import { describe, expect, it } from "vitest";
import { ownMonths } from "@/lib/company/own-months";

describe("ownMonths: a module with the only data picks its own months", () => {
  it("uses the module's months when no accounting months are loaded", () => {
    expect(ownMonths(0, ["2026-02", "2026-01", "2026-02"])).toEqual(["2026-01", "2026-02"]);
  });
  it("follows the accounts when they are loaded", () => {
    expect(ownMonths(12, ["2026-01"])).toBeUndefined();
  });
  it("gives nothing when the module is empty too", () => {
    expect(ownMonths(0, [])).toBeUndefined();
  });
});
