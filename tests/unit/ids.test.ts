import { describe, expect, it } from "vitest";
import { isUuid } from "@/lib/ids";

describe("isUuid", () => {
  it("accepts a real id", () => expect(isUuid("1c8c55b3-4c99-4511-9948-9f6a0b5e94f0")).toBe(true));
  it("refuses what a hand-edited address can hold", () => {
    for (const s of ["not-a-uuid", "", "9".repeat(300), "1c8c55b3-4c99-4511-9948-9f6a0b5e94f0x", "../admin", undefined, null]) expect(isUuid(s as string)).toBe(false);
  });
});
