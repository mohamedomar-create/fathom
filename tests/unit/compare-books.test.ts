// A company synced from Odoo is checked against the company it took its settings from (the uploads of the same
// books): every class, every month both hold, differences above 1 EGP listed, largest first.
import { describe, expect, it } from "vitest";
import { compareBooks } from "@/lib/company/compare";

const acc = (cls: string, amounts: Record<string, number>) => ({ cls, amounts });

describe("compare a synced company with its uploads", () => {
  it("lists each class that differs in the months both hold, largest first, ignoring rounding", () => {
    const here = [acc("cash", { "2026-08": 100, "2026-09": 200 }), acc("inventory", { "2026-09": 41_572_818 }), acc("revenue", { "2026-09": 23_957_303.4 })];
    const there = [acc("cash", { "2026-09": 200, "2026-10": 999 }), acc("inventory", { "2026-09": 54_672_024 }), acc("revenue", { "2026-09": 23_957_303 })];
    expect(compareBooks(here, there)).toEqual({ months: ["2026-09"], diffs: [{ period: "2026-09", cls: "inventory", here: 41_572_818, there: 54_672_024, diff: -13_099_206 }] });
  });
  it("no months in common: nothing to compare", () => {
    expect(compareBooks([acc("cash", { "2026-08": 1 })], [acc("cash", { "2026-09": 1 })])).toEqual({ months: [], diffs: [] });
  });
});
