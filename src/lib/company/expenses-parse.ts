import { BS_KEYS, EMPTY_EXPENSES, PL_KEYS, type ClassKey, type ExpensesData } from "@/lib/engine";

/** Numbers from the database summary, made safe: a missing or non-numeric value is 0. */
const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const CLASSES: readonly string[] = [...PL_KEYS, ...BS_KEYS];
/** A cost class, or a stock account's class for goods bought for stock (shown under suppliers, never in costs). */
const cls = (v: unknown): ClassKey | null => (CLASSES.includes(String(v)) ? (v as ClassKey) : null);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

export function parseExpenseSummary(raw: unknown): ExpensesData {
  if (!raw || typeof raw !== "object") return EMPTY_EXPENSES;
  const o = raw as { suppliers?: Record<string, unknown>[]; accounts?: Record<string, unknown>[]; sources?: Record<string, string>; flags?: Record<string, unknown>[] };
  return {
    suppliers: (o.suppliers ?? []).map((r) => ({ p: String(r.p), s: String(r.s ?? ""), j: String(r.j ?? ""), c: cls(r.c), a: n(r.a), d: n(r.d), n: n(r.n) })),
    accounts: (o.accounts ?? []).map((r) => ({ p: String(r.p), t: String(r.t ?? ""), g: String(r.g ?? ""), c: cls(r.c), a: n(r.a), n: n(r.n) })),
    sources: Object.fromEntries(Object.entries(o.sources ?? {}).map(([p, s]) => [p, s === "file" ? "file" : "ledger"])),
    flags: (o.flags ?? []).filter((f) => f.k === "large" || f.k === "double").map((f) => ({
      k: f.k as "large" | "double", d: day(f.d), p: String(f.p), doc: String(f.doc ?? ""), s: String(f.s ?? ""), t: String(f.t ?? ""), a: n(f.a),
      ...(f.k === "large" ? { m: n(f.m) } : { d2: day(f.d2), doc2: String(f.doc2 ?? "") }),
    })),
  };
}
