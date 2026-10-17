import { describe, expect, it } from "vitest";
import { CHECK_IDS, layerSummary, type Check } from "@/lib/company/checks";

const c = (id: Check["id"], severity: Check["severity"], accepted = false) => ({ id, severity, title: id, detail: "", accepted });

describe("checks grouped by layer", () => {
  it("every check belongs to exactly one layer, and the summary counts open, accepted and warnings", () => {
    const s = layerSummary([c("tb_zero", "block"), c("bs_balance", "block", true), c("continuity", "block"), c("review", "warn"), c("review", "warn"), c("gap", "info")]);
    expect(s.map((l) => [l.layer, l.open, l.accepted, l.warn])).toEqual([
      ["file", 1, 0, 0], ["identities", 0, 1, 0], ["continuity", 1, 0, 0], ["review", 0, 0, 2],
    ]);
    expect(new Set(CHECK_IDS.map((id) => layerSummary([c(id, "warn")]).find((l) => l.warn === 1)?.layer)).has(undefined)).toBe(false);
  });
});
