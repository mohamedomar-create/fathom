import { describe, expect, it } from "vitest";
import { keepForMode } from "@/lib/company/add-mode";

const lines = [{ period: "2026-08", v: 1 }, { period: "2026-09", v: 2 }, { period: "2026-10", v: 3 }];

describe("D22: 'add only new' keeps one rule for ledger and sheet lines: the new P&L months", () => {
  it("in add mode only lines in the months the import adds are kept", () => {
    expect(keepForMode(lines, "add", new Set(["2026-10"])).map((l) => l.v)).toEqual([3]);
  });
  it("with no new months nothing is kept", () => {
    expect(keepForMode(lines, "add", new Set())).toEqual([]);
  });
  it("any other mode keeps every line", () => {
    expect(keepForMode(lines, "replace", new Set())).toHaveLength(3);
    expect(keepForMode(lines, "merge", new Set(["2026-10"]))).toHaveLength(3);
  });
});
