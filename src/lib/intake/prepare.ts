// What one module's save is sent, worked out before anything is saved: the lines in the module's own shape, the months
// it replaces, its name and report, and a second count of the money (records against what is sent). A record that can't
// be sent (no month to save it under) is named, never dropped on the way.
import type { AgedReport } from "@/lib/ingest/aged";
import type { ExpenseLine } from "@/lib/ingest/expenses";
import type { PaymentLine } from "@/lib/ingest/payments";
import type { SalesLine } from "@/lib/ingest/sales";
import { moduleByKey } from "@/lib/modules/registry";
import { toExpenseLines, toGenericRows, toPaymentLines, toSalesLines, type GenericRow } from "./adapters";
import type { SaveGroup } from "./combine";
import type { Rec } from "./records";

export type Prepared =
  | ({ kind: "sales"; lines: SalesLine[] } | { kind: "expenses"; lines: ExpenseLine[] } | { kind: "payments"; lines: PaymentLine[] } | { kind: "generic"; lines: GenericRow[] } | { kind: "aged"; lines: []; aged: AgedReport })
  & { module: string; name: string; months: string[]; report: Record<string, unknown>; check: { records: number; sent: number; ok: boolean }; unsaved: { row: number; sheet: string; reason: string }[] };

const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
const months = (ps: (string | null | undefined)[]) => [...new Set(ps.filter((p): p is string => !!p && /^\d{4}-\d{2}$/.test(p)))].sort();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

export function prepareGroup(g: SaveGroup, currency: string, workbook: string): Prepared {
  const m = moduleByKey(g.module)!;
  const sheets = [...new Set(g.pieces.map((p) => p.id))];
  const name = clip(`${workbook} › ${sheets.join(", ")}`, 300);
  // "intake": a save of this workbook's tables, never taken for a re-upload of an earlier file of the same name.
  const report = { intake: true, mode: "intake", workbook: clip(workbook, 200), tabs: sheets.slice(0, 50), dropped: g.dropped, rows: g.pieces.map((p) => ({ tab: p.id, kept: p.read?.records.length ?? 0, rejected: p.read?.rejected.length ?? 0, skipped: p.read?.skipped.length ?? 0 })) };
  const base = { module: m.key, name, report };
  if (g.aged) return { ...base, kind: "aged", lines: [], aged: g.aged, months: [], check: { records: g.aged.total.total, sent: g.aged.total.total, ok: true }, unsaved: [] };
  const unsaved: Prepared["unsaved"] = [];
  const sendable: Rec[] = [], from: string[] = [];
  g.records.forEach((r, i) => { if (r.__period) { sendable.push(r); from.push(g.sheets[i] ?? g.pieces[0].sheet); } else unsaved.push({ row: r.__row, sheet: g.sheets[i] ?? g.pieces[0].sheet, reason: "no date to save it under" }); });
  const money = [m.amount, ...(m.amountAlt ?? [])];
  const recAmount = (r: Rec) => money.map((k) => r[k]).find((v): v is number => typeof v === "number") ?? 0;
  const records = r2(sendable.reduce((s, r) => s + recAmount(r), 0));
  const check = (sent: number, abs = false) => { const a = abs ? r2(sendable.reduce((s, r) => s + Math.abs(recAmount(r)), 0)) : records; return { records: a, sent: r2(sent), ok: Math.abs(a - sent) <= 0.01 }; };
  const sheetOf = (i: number) => from[i] ?? g.pieces[0].sheet;
  switch (m.storage) {
    case "sales_lines": {
      const lines = sendable.map((r, i) => ({ ...toSalesLines([r], sheetOf(i))[0] }));
      return { ...base, kind: "sales", lines, months: months(lines.map((l) => l.period)), check: check(lines.reduce((s, l) => s + l.amount, 0)), unsaved };
    }
    case "expense_lines": {
      const lines = sendable.map((r, i) => toExpenseLines([r], sheetOf(i))[0]);
      return { ...base, kind: "expenses", lines, months: months(lines.map((l) => l.period)), check: check(lines.reduce((s, l) => s + l.amount, 0)), unsaved };
    }
    case "payments": {
      const lines = toPaymentLines(sendable, currency);
      return { ...base, kind: "payments", lines, months: months(lines.map((l) => l.period)), check: check(lines.reduce((s, l) => s + Math.abs(l.amount), 0), true), unsaved };
    }
    default: {
      const lines = toGenericRows(sendable, m).map((x) => ({ ...x, doc: clip(x.doc, 120), partner: clip(x.partner, 200), data: Object.fromEntries(Object.entries(x.data).map(([k, v]) => [k, typeof v === "string" ? clip(v, 300) : v])) }));
      return { ...base, kind: "generic", lines, months: months(lines.map((l) => l.period)), check: check(lines.reduce((s, l) => s + l.amount, 0)), unsaved };
    }
  }
}
