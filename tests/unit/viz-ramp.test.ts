import { describe, expect, it } from "vitest";
import { ramp, rampInk, SEQ } from "@/components/viz/palette";

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("one-hue ramp for parts that sit side by side", () => {
  it("gives n distinct steps of the blue ramp, darkest first", () => {
    for (let n = 1; n <= 7; n++) {
      const r = ramp(n);
      expect(r).toHaveLength(n);
      expect(new Set(r).size).toBe(n);
      r.forEach((c) => expect(SEQ).toContain(c));
      const idx = r.map((c) => SEQ.indexOf(c as (typeof SEQ)[number]));
      expect([...idx].sort((a, b) => b - a)).toEqual(idx);
      expect(idx[0]).toBe(SEQ.length - 1);
    }
  });
  it("label ink clears 4.5:1 on every step", () => {
    for (const c of SEQ) expect(contrast(c, rampInk(c)), c).toBeGreaterThanOrEqual(4.5);
  });
});

describe("charts whose coloured parts touch use only the one-hue ramp", () => {
  it("mix tiles, ageing, costs by type, cash by activity and budget mixes take no categorical colour", async () => {
    const fs = await import("node:fs");
    const read = (p: string) => fs.readFileSync(p, "utf8");
    expect(read("src/components/viz/treemap.tsx")).not.toMatch(/SERIES/);
    expect(read("src/components/viz/ageing-stack.tsx")).not.toMatch(/STATUS|SERIES/);
    expect(read("src/components/analysis/budget-builder-view.tsx")).not.toMatch(/C\.s\[|SERIES/);
    const exp = read("src/components/expenses/expenses-overview.tsx");
    expect(exp.slice(exp.indexOf("card-exp-groups"))).not.toMatch(/C\.s\[/);
    const cf = read("src/components/analysis/cashflow-page.tsx");
    expect(cf.slice(cf.indexOf("card-cash-activity"), cf.indexOf("card-cash-line"))).not.toMatch(/SERIES/);
  });
});

describe("small ramps", () => {
  it("leave out the near-white step so light parts still show on a white card", () => {
    for (let n = 2; n <= 6; n++) expect(ramp(n)).not.toContain(SEQ[0]);
  });
  it("payments received/paid bars use the ramp, not categorical colours", async () => {
    const fs = await import("node:fs");
    expect(fs.readFileSync("src/components/payments/payments-pages.tsx", "utf8")).not.toMatch(/SERIES/);
  });
});
