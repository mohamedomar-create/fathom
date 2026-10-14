/**
 * The totals people write in their own sheets: "SUM(L21:L82)", "B24+B46+B69", "SUM(M29:M45)+M11", "L72-M72".
 * Only sums and differences of cells and ranges on the same sheet are understood; anything else (multiplying, other
 * functions, other sheets) is not a total iReport can check, and returns null.
 */
export interface Term { sign: 1 | -1; r0: number; c0: number; r1: number; c1: number }

const colNum = (s: string) => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const CELL = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;
const cell = (s: string) => { const m = s.match(CELL); return m ? { r: Number(m[2]) - 1, c: colNum(m[1]) } : null; };
const area = (s: string) => {
  const [a, b = a] = s.split(":");
  const x = cell(a), y = cell(b);
  if (!x || !y) return null;
  return { r0: Math.min(x.r, y.r), c0: Math.min(x.c, y.c), r1: Math.max(x.r, y.r), c1: Math.max(x.c, y.c) };
};

/** The terms of a sum, in the grid's own row and column numbers (origin: where the grid starts in the sheet). */
export function sumTerms(formula: string, origin: { r: number; c: number } = { r: 0, c: 0 }): Term[] | null {
  const f = formula.replace(/^=/, "").replace(/\s+/g, "");
  if (!f || f.length > 400 || /[!'"]/.test(f)) return null;
  const parts = f.match(/[+-]?[^+-]+/g);
  if (!parts) return null;
  const out: Term[] = [];
  for (const p of parts) {
    const sign: 1 | -1 = p.startsWith("-") ? -1 : 1;
    const body = p.replace(/^[+-]/, "");
    const inner = body.match(/^SUM\((.+)\)$/i)?.[1];
    for (const ref of inner ? inner.split(/[,;]/) : [body]) {
      const a = area(ref);
      if (!a) return null;
      out.push({ sign, r0: a.r0 - origin.r, c0: a.c0 - origin.c, r1: a.r1 - origin.r, c1: a.c1 - origin.c });
    }
  }
  return out.length ? out : null;
}

/** "L21:L82" for messages, in the sheet's own references. */
export function termText(t: Term, origin: { r: number; c: number } = { r: 0, c: 0 }) {
  const col = (i: number) => { let s = "", n = i + 1; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
  const a = `${col(t.c0 + origin.c)}${t.r0 + origin.r + 1}`, b = `${col(t.c1 + origin.c)}${t.r1 + origin.r + 1}`;
  return a === b ? a : `${a}:${b}`;
}
