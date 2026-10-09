import { describe, expect, it } from "vitest";
import { bsCalc, lineParts, LINE_PARTS, plCalc, type BSCalc, type PLCalc } from "@/lib/engine";
import { months } from "../fixtures/odoo";

describe("statement lines trace back to classes", () => {
  it("every total equals the signed sum of its classes", () => {
    for (const m of months) {
      const P = plCalc(m.pl), B = bsCalc(m.bs);
      const src = { ...m.pl, ...m.bs } as Record<string, number>;
      for (const key of Object.keys(LINE_PARTS)) {
        const sum = lineParts(key).reduce((s, p) => s + (src[p.cls] ?? 0) * p.sign, 0);
        const want = key in P ? (P[key as keyof PLCalc] as number) : (B[key as keyof BSCalc] as number);
        expect(Math.round(sum), `${m.period} ${key}`).toBe(Math.round(want));
      }
    }
  });
});
