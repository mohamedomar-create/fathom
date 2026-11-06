// Made-up rows for a module added by definition, so the demo company shows its page (no real company's data).
import { moduleByKey } from "./registry";
import { sampleRows } from "./template";
import { toGenericRows } from "@/lib/intake/adapters";
import type { Rec } from "@/lib/intake/records";
import type { ModuleRow, ModuleSummary } from "@/components/modules/module-page";

export function demoModule(key: string): { summary: ModuleSummary; rows: ModuleRow[] } | null {
  const m = moduleByKey(key);
  if (!m || m.storage !== "generic") return null;
  const recs = sampleRows(m, 6).map((r, i) => ({ ...r, __row: i + 2, __period: `2026-${String(5 + i).padStart(2, "0")}`, [m.date ?? "date"]: `2026-${String(5 + i).padStart(2, "0")}-10` }) as Rec);
  const rows = toGenericRows(recs, m).map((r, i) => ({ id: i + 1, ...r, data: r.data }));
  const by = <K extends string>(f: (r: ModuleRow) => K) => { const out = new Map<K, { amount: number; qty: number; rows: number }>(); for (const r of rows) { const k = f(r); const o = out.get(k) ?? { amount: 0, qty: 0, rows: 0 }; o.amount += r.amount; o.qty += r.qty ?? 0; o.rows++; out.set(k, o); } return out; };
  const summary: ModuleSummary = {
    rows: rows.length, docs: new Set(rows.map((r) => r.doc)).size, amount: rows.reduce((s, r) => s + r.amount, 0),
    periods: [...by((r) => r.period)].map(([period, v]) => ({ period, amount: v.amount, qty: v.qty, rows: v.rows })).sort((a, b) => a.period.localeCompare(b.period)),
    partners: [...by((r) => r.partner)].map(([partner, v]) => ({ partner, amount: v.amount, rows: v.rows })).sort((a, b) => b.amount - a.amount),
    batches: [{ id: "demo", filename: "Demo purchase orders.xlsx", at: "2026-10-31T00:00:00Z", rows: rows.length }],
  };
  return { summary, rows };
}
