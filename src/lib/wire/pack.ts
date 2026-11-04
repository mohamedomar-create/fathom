/**
 * Page data in a compact form for the trip to the browser. A list of same-shaped rows (every row a flat object with the
 * same keys) is sent as columns, and every text in such a column is written once in a shared list and referred to by
 * position: a summary of 20,000 rows repeats each customer, product and month thousands of times otherwise. Everything
 * else is kept as it is. unpack(pack(x)) gives back exactly x.
 */
const P = "~pack";
const T = "~t";
type Prim = string | number | boolean | null | undefined;
type Col = ["s", number[]] | ["v", Prim[]];
type Table = { [T]: string[]; c: Col[]; n: number };
export interface Packed { [P]: 1; s: string[]; v: unknown }

const O = "~o";
/** Only plain objects are walked into; a Date, Map or class instance is passed on as it is. */
const isPlain = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const isPrim = (x: unknown): x is Prim => x === null || x === undefined || ["string", "number", "boolean"].includes(typeof x);
const isRow = (x: unknown): x is Record<string, Prim> => isPlain(x) && !(T in x) && !(O in x) && Object.values(x).every(isPrim);

export function pack(value: unknown): Packed {
  const dict: string[] = [];
  const at = new Map<string, number>();
  const ref = (s: string) => { let i = at.get(s); if (i === undefined) { i = dict.length; dict.push(s); at.set(s, i); } return i; };
  const enc = (x: unknown): unknown => {
    if (Array.isArray(x)) {
      if (x.length >= 2 && x.every(isRow)) {
        const keys = Object.keys(x[0]);
        const sig = [...keys].sort().join("\u0001");
        if (x.every((r) => Object.keys(r).length === keys.length && [...Object.keys(r)].sort().join("\u0001") === sig)) {
          const c: Col[] = keys.map((k) => {
            const vals = x.map((r) => (r as Record<string, Prim>)[k]);
            return vals.every((v) => typeof v === "string" || v === null)
              ? ["s", vals.map((v) => (v === null ? -1 : ref(v as string)))]
              : ["v", vals];
          });
          const t: Table = { [T]: keys, c, n: x.length };
          return t;
        }
      }
      return x.map(enc);
    }
    if (isPlain(x)) {
      const o = Object.fromEntries(Object.entries(x).map(([k, v]) => [k, enc(v)]));
      // A map whose own keys look like the codec's markers is wrapped, so it is never read back as a table.
      return T in x || O in x ? { [O]: o } : o;
    }
    return x;
  };
  const v = enc(value);
  return { [P]: 1, s: dict, v };
}

export function isPacked(x: unknown): x is Packed {
  return !!x && typeof x === "object" && (x as Record<string, unknown>)[P] === 1;
}

export function unpack<T>(p: Packed | T): T {
  if (!isPacked(p)) return p as T;
  const dict = p.s;
  const dec = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(dec);
    if (isPlain(x)) {
      const o = x;
      if (isPlain(o[O]) && Object.keys(o).length === 1) return Object.fromEntries(Object.entries(o[O] as Record<string, unknown>).map(([k, v]) => [k, dec(v)]));
      if (Array.isArray(o[T])) {
        const t = o as unknown as Table;
        const keys = t[T];
        const out: Record<string, Prim>[] = new Array(t.n);
        for (let i = 0; i < t.n; i++) {
          const r: Record<string, Prim> = {};
          for (let j = 0; j < keys.length; j++) {
            const col = t.c[j];
            r[keys[j]] = col[0] === "s" ? (col[1][i] === -1 ? null : dict[col[1][i]]) : col[1][i];
          }
          out[i] = r;
        }
        return out;
      }
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, dec(v)]));
    }
    return x;
  };
  return dec(p.v) as T;
}
