"use client";
// Saving the intake: one save per module (its tabs combined, each document once), through the module's own staged save,
// one module at a time, so a failure stops at that module with everything before it saved and nothing after it touched.
// The money sent is counted again against the records before each save; a difference stops the save.
import { saveSales } from "@/lib/company/save-sales";
import { saveExpenses } from "@/lib/company/save-expenses";
import { savePayments } from "@/lib/company/save-payments";
import { saveStaged } from "@/lib/company/save-lines";
import { saveAgedReport } from "@/app/company/[id]/settings/payments-actions";
import { addModuleRows, finishModuleBatch, rememberLayout, startModuleBatch } from "@/app/company/[id]/data/intake-actions";
import type { ChunkOptions } from "@/lib/chunks";
import { rememberable } from "./map";
import { layoutKey } from "./memory";
import type { SaveGroup } from "./combine";
import { prepareGroup, type Prepared } from "./prepare";

export type SaveResult = { ok: true; saved: number } | { ok: false; error: string };
/** Lines before the balances built from them; the shared store last. */
const ORDER = ["sales", "expenses", "payments", "ar_open", "ap_open"];
export const saveOrder = <T extends { module: string | null }>(xs: T[]) => [...xs].sort((a, b) => (ORDER.indexOf(a.module ?? "") + 1 || 99) - (ORDER.indexOf(b.module ?? "") + 1 || 99));

async function send(companyId: string, p: Prepared, onProgress?: ChunkOptions["onProgress"]): Promise<SaveResult> {
  switch (p.kind) {
    case "sales": return saveSales(companyId, "file", p.lines, p.name, p.report, { months: p.months, onProgress });
    case "expenses": return saveExpenses(companyId, "file", p.lines, p.name, p.report, { months: p.months, onProgress });
    case "payments": return savePayments(companyId, "file", p.lines, p.months, p.name, onProgress);
    case "aged": {
      const r = p.aged;
      return saveAgedReport({ companyId, side: r.side, asOf: r.asOf!, buckets: r.buckets, total: r.total, findings: r.findings.slice(0, 20), filename: p.name,
        items: r.items.map((i) => ({ partner: i.partner.slice(0, 200), ref: i.ref.slice(0, 120), memo: i.memo.slice(0, 300), day: i.day, amounts: i.amounts, total: i.total })) });
    }
    default:
      if (!p.months.length) return { ok: false, error: "No row has a date to save it under." };
      return saveStaged(p.lines, { open: () => startModuleBatch(companyId, p.module, p.months, p.name), add: (batch, part) => addModuleRows(companyId, batch, part), finish: (batch) => finishModuleBatch(companyId, batch) }, { onProgress });
  }
}

export async function saveGroup(companyId: string, g: SaveGroup, currency: string, workbook: string, onProgress?: ChunkOptions["onProgress"]): Promise<SaveResult> {
  if (g.aged && !g.aged.asOf) return { ok: false, error: "Give the as-of day for this list first." };
  const p = prepareGroup(g, currency, workbook);
  if (p.unsaved.length) return { ok: false, error: `${p.unsaved.length} row(s) have no date to save them under (${p.unsaved.slice(0, 3).map((u) => `${u.sheet} row ${u.row}`).join(", ")})` };
  if (!p.check.ok) return { ok: false, error: `The money to save (${p.check.sent}) differs from the rows read (${p.check.records}); nothing was saved for this module` };
  const res = await send(companyId, p, onProgress);
  // Once saved, each tab's layout and mapping are remembered for the next upload (never before: a failed save teaches nothing).
  if (res.ok) for (const piece of g.pieces) {
    if (!piece.map) continue;
    const heads = (piece.piece.rows[piece.map.headerRow] ?? []).map((v) => (v === null || v === undefined ? "" : String(v))).filter((h) => h.trim());
    await rememberLayout(companyId, layoutKey(g.module, heads), rememberable(piece.piece, piece.map)).catch(() => undefined);
  }
  return res;
}
