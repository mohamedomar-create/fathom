import { EMPTY_SALES, type SalesData } from "@/lib/engine";

/** Numbers from the database summary, made safe: a missing or non-numeric value is 0 (amounts) or null (cost, quantity). */
const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : null);

export function parseSalesSummary(raw: unknown): SalesData {
  if (!raw || typeof raw !== "object") return EMPTY_SALES;
  const o = raw as { customers?: Record<string, unknown>[]; products?: Record<string, unknown>[]; sources?: Record<string, string> };
  return {
    customers: (o.customers ?? []).map((r) => ({ p: String(r.p), c: String(r.c ?? ""), s: String(r.s ?? ""), sp: String(r.sp ?? ""), a: n(r.a) ?? 0, k: n(r.k), ka: n(r.ka), q: n(r.q), d: n(r.d) ?? 0, n: n(r.n) ?? 0 })),
    products: (o.products ?? []).map((r) => ({ p: String(r.p), r: String(r.r ?? ""), g: String(r.g ?? ""), s: String(r.s ?? ""), a: n(r.a) ?? 0, k: n(r.k), ka: n(r.ka), q: n(r.q), n: n(r.n) ?? 0 })),
    sources: Object.fromEntries(Object.entries(o.sources ?? {}).map(([p, s]) => [p, s === "file" ? "file" : "ledger"])),
  };
}
