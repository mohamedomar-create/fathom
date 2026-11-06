// Tabs going to the same module become one save: a module's save replaces the months it covers, so two saves would let
// the second wipe the first. A document in two tabs (an invoice list and the same invoices' lines) is kept once, from
// the tab with more detail (more of the module's distinguishing columns); the other tab's copy is counted as dropped.
import type { AgedReport } from "@/lib/ingest/aged";
import { moduleByKey } from "@/lib/modules/registry";
import { openItemsReport } from "./open-items";
import type { PlannedPiece } from "./plan";
import type { Rec } from "./records";

export interface SaveGroup {
  module: string;
  pieces: PlannedPiece[];
  records: Rec[];
  /** Copies of a document already kept from a more detailed tab. */
  dropped: { piece: string; docs: number; rows: number }[];
  /** Open items: the ageing report built from every list (or Odoo's own report). */
  aged?: AgedReport;
  /** Where each record came from (the tab), for its row number. */
  sheets: string[];
}

const docKey = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toUpperCase();

function detail(p: PlannedPiece): number {
  const m = p.module ? moduleByKey(p.module) : null;
  if (!m || !p.map) return 0;
  return (m.signature ?? []).flat().filter((k) => k in p.map!.cols).length * 10 + Object.keys(p.map.cols).length;
}

export function combineForSave(pieces: PlannedPiece[]): SaveGroup[] {
  const out: SaveGroup[] = [];
  const byKey = new Map<string, PlannedPiece[]>();
  for (const p of pieces) {
    if (!p.module) continue;
    if (p.layout === "odoo_aged" && p.aged) { out.push({ module: p.module, pieces: [p], records: [], dropped: [], aged: p.aged, sheets: [] }); continue; }
    if (!p.read) continue;
    // Open items at different days are different reports; at the same day they are one.
    const k = p.module === "ar_open" || p.module === "ap_open" ? `${p.module}|${p.aged?.asOf ?? ""}` : p.module;
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  for (const [, ps] of byKey) {
    const m = moduleByKey(ps[0].module!)!;
    const docField = m.doc;
    const ranked = [...ps].sort((a, b) => detail(b) - detail(a));
    const taken = new Set<string>();
    const keep = new Map<PlannedPiece, Rec[]>();
    const dropped: SaveGroup["dropped"] = [];
    // Within one tab, a document's several lines are all kept; across tabs, only the most detailed tab's lines.
    for (const p of ranked) {
      const mine = new Set<string>();
      const rows: Rec[] = [];
      let n = 0;
      const docs = new Set<string>();
      for (const r of p.read!.records) {
        const d = docField ? docKey(r[docField]) : "";
        if (d && taken.has(d)) { n++; docs.add(d); continue; }
        if (d) mine.add(d);
        rows.push(r);
      }
      for (const d of mine) taken.add(d);
      keep.set(p, rows);
      if (n) dropped.push({ piece: p.id, docs: docs.size, rows: n });
    }
    const records = ps.flatMap((p) => keep.get(p)!);
    const sheets = ps.flatMap((p) => keep.get(p)!.map(() => p.sheet));
    const g: SaveGroup = { module: m.key, pieces: ps, records, dropped, sheets };
    if (m.key === "ar_open" || m.key === "ap_open") {
      const asOf = ps[0].aged?.asOf;
      if (asOf) g.aged = openItemsReport(records, m.key === "ar_open" ? "receivable" : "payable", asOf);
    }
    out.push(g);
  }
  return out;
}
