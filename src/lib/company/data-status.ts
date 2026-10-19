// The sub-ledger steps of the Data section, from the books and the same tie-outs the sector pages show: sales detail
// (months from a file) against the ledger's revenue, stock against the stock accounts, each ageing report against its
// control account.
import { hasPL, plCalc } from "@/lib/engine";
import { agedTieouts, inventoryTies, type ReadinessInput } from "./readiness";
import type { DataStatus } from "./data-steps";

/** The sub-ledger steps' status: small enough to send to the page instead of the data behind it. */
export type SubLedgers = Pick<DataStatus, "sales" | "stock" | "ageing">;

export function subLedgerStatus(x: ReadinessInput): SubLedgers {
  const s = x.sales;
  const fileMonths = s ? Object.entries(s.sources).filter(([, v]) => v === "file").map(([p]) => p).sort() : [];
  const byMonth = new Map<string, number>();
  for (const r of s?.customers ?? []) byMonth.set(r.p, (byMonth.get(r.p) ?? 0) + r.a);
  const revenue = new Map(x.months.filter(hasPL).map((m) => [m.period, plCalc(m.pl).revenue]));
  // Within 1% of the month's revenue, as the Sales readiness check; a month with no P&L can't be checked yet.
  const untied = fileMonths.filter((p) => revenue.has(p) && Math.abs((byMonth.get(p) ?? 0) - revenue.get(p)!) > Math.max(1, Math.abs(revenue.get(p)!) * 0.01));
  const checked = inventoryTies(x).filter((t) => t.status !== "no_ledger");
  return {
    sales: fileMonths.length ? { months: fileMonths, untied } : null,
    stock: checked.length ? { checked: checked.length, ok: checked.filter((t) => t.status === "ok").length } : null,
    ageing: x.payments ? agedTieouts(x).map((t) => ({ side: t.side, asOf: t.asOf, status: t.status })) : [],
  };
}
