"use client";
// Saving the intake: each placed table goes to its module through the module's own save (the same staged save its own
// upload card uses), one table at a time, so a failure stops at that table with everything before it saved and nothing
// after it touched. The person can try again from the table that failed.
import { saveSales } from "@/lib/company/save-sales";
import { saveExpenses } from "@/lib/company/save-expenses";
import { savePayments } from "@/lib/company/save-payments";
import { saveStaged } from "@/lib/company/save-lines";
import { saveAgedReport } from "@/app/company/[id]/settings/payments-actions";
import { addModuleRows, finishModuleBatch, rememberLayout, startModuleBatch } from "@/app/company/[id]/data/intake-actions";
import { moduleByKey } from "@/lib/modules/registry";
import type { ChunkOptions } from "@/lib/chunks";
import { toExpenseLines, toGenericRows, toPaymentLines, toSalesLines } from "./adapters";
import { rememberable } from "./map";
import { layoutKey } from "./memory";
import type { PlannedPiece } from "./plan";

export type SaveResult = { ok: true; saved: number } | { ok: false; error: string };
/** The order tables are saved in: lines before the balances built from them, the shared store last. */
const ORDER = ["sales", "expenses", "payments", "ar_open", "ap_open"];
export const saveOrder = (pieces: PlannedPiece[]) => [...pieces].sort((a, b) => (ORDER.indexOf(a.module ?? "") + 1 || 99) - (ORDER.indexOf(b.module ?? "") + 1 || 99));

const months = (ps: (string | null | undefined)[]) => [...new Set(ps.filter((p): p is string => !!p && /^\d{4}-\d{2}$/.test(p)))].sort();

export async function savePiece(companyId: string, p: PlannedPiece, currency: string, onProgress?: ChunkOptions["onProgress"]): Promise<SaveResult> {
  const m = p.module ? moduleByKey(p.module) : null;
  if (!m || (!p.read && !p.aged)) return { ok: false, error: "This table has no module yet." };
  const name = `${p.sheet}${p.id !== p.sheet ? ` (${p.id.split(" › ").pop()})` : ""}`.slice(0, 300);
  if (!p.read) {
    if (m.key !== "ar_open" && m.key !== "ap_open") return { ok: false, error: "This table has no module yet." };
  }
  const read = p.read ?? { records: [], rejected: [], skipped: [], proof: null };
  const report = { intake: true, sheet: p.sheet, rows: { kept: read.records.length, rejected: read.rejected.length, skipped: read.skipped.length }, proof: read.proof };
  let res: SaveResult;
  switch (m.key) {
    case "sales": { const lines = toSalesLines(read.records, p.sheet); res = await saveSales(companyId, "file", lines, name, report, { months: months(lines.map((l) => l.period)), onProgress }); break; }
    case "expenses": { const lines = toExpenseLines(read.records, p.sheet); res = await saveExpenses(companyId, "file", lines, name, report, { months: months(lines.map((l) => l.period)), onProgress }); break; }
    case "payments": { const lines = toPaymentLines(read.records, currency).filter((l) => l.day); res = await savePayments(companyId, "file", lines, months(lines.map((l) => l.period)), name, onProgress); break; }
    case "ar_open": case "ap_open": {
      const r = p.aged;
      if (!r?.asOf) return { ok: false, error: "Give the as-of day for this list first." };
      res = await saveAgedReport({ companyId, side: r.side, asOf: r.asOf, buckets: r.buckets, total: r.total, findings: r.findings.slice(0, 20), filename: name,
        items: r.items.map((i) => ({ partner: i.partner.slice(0, 200), ref: i.ref.slice(0, 120), memo: i.memo.slice(0, 300), day: i.day, amounts: i.amounts, total: i.total })) });
      break;
    }
    default: {
      const rows = toGenericRows(read.records, m).filter((r) => r.period);
      const ms = months(rows.map((r) => r.period));
      if (!ms.length) return { ok: false, error: "No row has a date to save it under." };
      res = await saveStaged(rows, {
        open: () => startModuleBatch(companyId, m.key, ms, name),
        add: (batch, part) => addModuleRows(companyId, batch, part),
        finish: (batch) => finishModuleBatch(companyId, batch),
      }, { onProgress });
    }
  }
  // Once saved, the layout and its mapping are remembered for the next upload (never before: a failed save teaches nothing).
  if (res.ok && p.map) {
    const heads = (p.piece.rows[p.map.headerRow] ?? []).map((v) => (v === null || v === undefined ? "" : String(v))).filter((h) => h.trim());
    await rememberLayout(companyId, layoutKey(m.key, heads), rememberable(p.piece, p.map)).catch(() => undefined);
  }
  return res;
}
