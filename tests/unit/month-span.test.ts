import { describe, expect, it } from "vitest";
import { monthSpan } from "@/lib/month-span";
import { mlabel } from "@/lib/engine";

describe("D6: the Checks page names its months from first to last", () => {
  it("unsorted months give the earliest to the latest", () => {
    expect(monthSpan(["2023-09", "2023-01", "2023-05"], mlabel)).toBe("Jan 2023 – Sep 2023");
  });
  it("one month, and none", () => {
    expect(monthSpan(["2023-09"], mlabel)).toBe("Sep 2023");
    expect(monthSpan([], mlabel)).toBe("–");
  });
});
