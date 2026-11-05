import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { KPI_DEFS } from "@/lib/engine/kpis";

describe("the metric catalog matches the engine", () => {
  const doc = readFileSync("docs/metric-catalog.md", "utf8");
  it("lists every KPI the engine defines, with its formula", () => {
    for (const k of KPI_DEFS) {
      expect(doc, k.key).toContain(`\`${k.key}\``);
      expect(doc, k.key).toContain(k.formula.replace(/\|/g, "\\|"));
    }
  });
  it("lists nothing the engine doesn't define", () => {
    const keys = [...doc.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual(KPI_DEFS.map((k) => k.key).sort());
  });
});
