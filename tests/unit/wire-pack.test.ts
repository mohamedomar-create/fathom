// What a page sends to the browser, in a compact form: long lists of same-shaped rows go as columns, and each repeated
// text (a customer, a product, a month) is written once. The browser gets back exactly the same data.
import { describe, expect, it } from "vitest";
import { isPacked, pack, unpack } from "@/lib/wire/pack";

const months = Array.from({ length: 24 }, (_, i) => `20${24 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
/** A sales summary the size of a real company: 300 customers × 24 months, 200 products × 24 months. */
function sales() {
  const customers = months.flatMap((p) => Array.from({ length: 300 }, (_, i) => ({ p, c: `Customer number ${i}`, s: i % 3 ? "INV" : "", sp: `Salesperson ${i % 7}`, a: 1000 + i, k: i % 5 ? 600 + i : null, ka: i % 5 ? 1000 + i : null, q: i % 4 ? i : null, d: 3, n: 4 })));
  const products = months.flatMap((p) => Array.from({ length: 200 }, (_, i) => ({ p, r: `Product ${i}`, g: `Category ${i % 9}`, s: "INV", a: 500.25 + i, k: null, ka: null, q: 2 * i, n: 1 })));
  return { customers, products, sources: { "2024-01": "ledger" as const, "2024-02": "file" as const } };
}

describe("compact page data", () => {
  it("comes back exactly the same", () => {
    const s = sales();
    expect(unpack(pack(s))).toEqual(s);
  });

  it("is much smaller than the plain form (at least 3 times)", () => {
    const s = sales();
    expect(JSON.stringify(s).length / JSON.stringify(pack(s)).length).toBeGreaterThan(3);
  });

  it("keeps rows of different shapes, nested data, empty lists, nulls, booleans and texts that look like numbers", () => {
    const odd = {
      aged: { receivable: { asOf: "2026-09-30", buckets: ["0-30", "31-60"], items: [{ partner: "A", amounts: [1, 2], total: 3, day: null }, { partner: "B", amounts: [], total: 0, day: "2026-01-01" }] } },
      payments: [] as unknown[],
      mixed: [{ a: 1 }, { b: "x" }, { a: 2, b: null }],
      flags: [{ kind: "large", a: -5.5, open: true, m: "12" }, { kind: "double", a: 0, open: false, m: "12" }],
      text: "plain", n: 0, none: null,
    };
    expect(unpack(pack(odd))).toEqual(odd);
  });

  it("is recognised as packed, and plain data is left alone by the reader", () => {
    expect(isPacked(pack(sales()))).toBe(true);
    const plain = { customers: [], products: [], sources: {} };
    expect(isPacked(plain)).toBe(false);
  });
});
