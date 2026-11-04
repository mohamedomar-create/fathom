import { describe, expect, it } from "vitest";
import { inkOn, OTHER, tileFill } from "@/components/viz/treemap";
import { SEQ } from "@/components/viz/palette";

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("treemap tiles", () => {
  it("are one hue (the blue ramp), largest darkest, and every label clears 4.5:1", () => {
    for (let n = 1; n <= 6; n++) {
      for (let i = 0; i < n; i++) {
        const f = tileFill(i, n);
        expect(SEQ).toContain(f);
        expect(contrast(f, inkOn(f)), `${n}:${i}`).toBeGreaterThanOrEqual(4.5);
      }
      if (n > 1) expect(SEQ.indexOf(tileFill(0, n) as (typeof SEQ)[number])).toBeGreaterThan(SEQ.indexOf(tileFill(n - 1, n) as (typeof SEQ)[number]));
    }
  });
  it("Other is grey with a readable label", () => {
    expect(tileFill(-1, 6)).toBe(OTHER);
    expect(contrast(OTHER, inkOn(OTHER))).toBeGreaterThanOrEqual(4.5);
  });
});
