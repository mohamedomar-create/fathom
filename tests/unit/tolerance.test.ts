import { describe, expect, it } from "vitest";
import { TIE_EGP, tied, differs, balanced } from "@/lib/tolerance";
import { tolerance } from "@/lib/company/checks";
import { untied } from "@/lib/company/ledger-tie";
import { TIE_TOLERANCE } from "@/lib/engine/tieout";

describe("one rule everywhere: figures agree to 1 EGP", () => {
  it("within one pound agrees, more than one pound does not, whatever the size of the books", () => {
    expect(TIE_EGP).toBe(1);
    expect(tied(1_000_000, 1_000_000.99)).toBe(true);
    expect(tied(1_000_000, 1_000_001.01)).toBe(false);
    expect(differs(50_000_000, 50_000_010)).toBe(true);
    expect(balanced(0.6)).toBe(true);
    expect(balanced(-1.2)).toBe(false);
  });
  it("quantities agree only exactly", () => expect(tied(10, 10.5, "qty")).toBe(false));
  it("the checks, the stock tie-outs and the ledger tie use the same rule", () => {
    expect(tolerance(500_000_000)).toBe(1);
    expect(TIE_TOLERANCE).toBe(1);
    // 0.3% off on a large month used to pass the ledger tie (0.5%) while readiness said it did not agree.
    const accounts = [{ cls: "revenue" as const, amounts: { "2026-09": 10_000_000 } }];
    expect(untied({ sales: { "2026-09": 10_030_000 }, expenses: {} }, accounts).sales).toEqual(["2026-09"]);
    expect(untied({ sales: { "2026-09": 10_000_000.4 }, expenses: {} }, accounts).sales).toEqual([]);
  });
});
