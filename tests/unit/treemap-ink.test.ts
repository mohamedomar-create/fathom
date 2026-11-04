import { describe, expect, it } from "vitest";
import { inkOn, OTHER, tileFill } from "@/components/viz/treemap";

/** WCAG 2.x relative luminance and contrast ratio. */
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("treemap tile labels", () => {
  it("every named tile's label clears 4.5:1 on its fill", () => {
    for (let i = 0; i < 8; i++) expect(contrast(tileFill(i), inkOn(i)), `tile ${i} ${tileFill(i)} / ${inkOn(i)}`).toBeGreaterThanOrEqual(4.5);
  });
  it("the Other tile's label clears 4.5:1", () => {
    expect(contrast(OTHER, inkOn(-1))).toBeGreaterThanOrEqual(4.5);
  });
});
