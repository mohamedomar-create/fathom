// The tabs of one upload checked against each other, as an accountant would before posting anything: open items against
// the invoices they come from, the same document in two lists, two lists of the same documents with different totals.
// Never adjusted: a difference is shown with the documents behind it.
import { TIE_EGP } from "@/lib/tolerance";
import type { Rec } from "./records";

export interface Part { id: string; module: string; records: Rec[] }
export interface Reconciliation {
  key: "open_vs_invoices" | "open_vs_bills" | "same_docs" | "duplicate_docs";
  label: string;
  status: "ok" | "off" | "info";
  detail: string;
  /** The documents behind a difference ("INV/2026/0101: open 15,000 against the invoice's 12,000"). */
  items: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
const fmt = (n: number) => r2(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const num = (v: unknown) => (typeof v === "number" ? v : null);
const key = (d: unknown) => String(d ?? "").replace(/\s+/g, "").toUpperCase();

/** Each document's amount in a list (a document's lines added up): the untaxed amount, else the total. */
function byDoc(records: Rec[], amount: (r: Rec) => number | null) {
  const m = new Map<string, number>();
  for (const r of records) { const d = key(r.doc); if (!d) continue; const a = amount(r); if (a === null) continue; m.set(d, r2((m.get(d) ?? 0) + a)); }
  return m;
}
const net = (r: Rec) => num(r.untaxed) ?? num(r.total);

/**
 * opts.vat: the VAT rate the company charges (0.14 in Egypt by default): open items carry VAT, a sales list's untaxed
 * amounts don't, so an open item is checked against the invoice's untaxed amount plus VAT when no total is given.
 */
export function reconcile(parts: Part[], opts: { vat?: number } = {}): Reconciliation[] {
  const vat = opts.vat ?? 0.14;
  const out: Reconciliation[] = [];
  const side = (open: string, list: string, k: Reconciliation["key"], label: string) => {
    const opens = parts.filter((p) => p.module === open);
    const lists = parts.filter((p) => p.module === list);
    if (!opens.length || !lists.length) return;
    const recs = lists.flatMap((p) => p.records);
    const inv = byDoc(recs, (r) => { const g = num(r.total); return g ?? (net(r) === null ? null : r2(net(r)! * (1 + vat))); });
    const items: string[] = [];
    let unmatched = 0, unmatchedAmount = 0;
    for (const r of opens.flatMap((p) => p.records)) {
      const d = key(r.doc), open = num(r.open) ?? 0;
      if (!d) continue;
      const invoiced = inv.get(d);
      if (invoiced === undefined) { unmatched++; unmatchedAmount = r2(unmatchedAmount + open); continue; }
      if (open - invoiced > TIE_EGP) items.push(`${String(r.doc)}: ${fmt(open)} still due against ${fmt(invoiced)} invoiced (row ${r.__row})`);
    }
    const notes = unmatched ? ` ${unmatched} open item${unmatched > 1 ? "s" : ""} (${fmt(unmatchedAmount)}) are for documents not in this upload (older ones, most likely).` : "";
    out.push({ key: k, label, status: items.length ? "off" : "ok", detail: items.length ? `${items.length} open item${items.length > 1 ? "s are" : " is"} larger than the document it comes from.${notes}` : `Every open item that has its document in the upload is no more than it.${notes}`, items });
  };
  side("ar_open", "sales", "open_vs_invoices", "Receivables against the invoices");
  side("ap_open", "expenses", "open_vs_bills", "Payables against the bills");

  // Two lists of the same module holding the same documents (an invoice list and its lines): their totals must agree.
  for (const mod of ["sales", "expenses"]) {
    const ps = parts.filter((p) => p.module === mod);
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = byDoc(ps[i].records, net), b = byDoc(ps[j].records, net);
      const common = [...a.keys()].filter((d) => b.has(d));
      if (!common.length) continue;
      const items = common.filter((d) => Math.abs(a.get(d)! - b.get(d)!) > TIE_EGP).map((d) => `${d}: ${fmt(a.get(d)!)} in ${ps[i].id}, ${fmt(b.get(d)!)} in ${ps[j].id}`);
      out.push({ key: "same_docs", label: `${ps[i].id} against ${ps[j].id}`, status: items.length ? "off" : "ok", detail: `${common.length} document${common.length > 1 ? "s are" : " is"} in both: ${items.length ? `${items.length} differ` : "same amounts"}. They are saved once.`, items });
    }
  }
  // The same document twice in one list is a copy, unless it is an invoice's lines (several products).
  for (const p of parts) {
    if (p.module === "sales" || p.module === "expenses") continue;
    const seen = new Map<string, number>();
    for (const r of p.records) { const d = key(r.doc); if (d) seen.set(d, (seen.get(d) ?? 0) + 1); }
    const dup = [...seen].filter(([, n]) => n > 1).map(([d, n]) => `${d} × ${n}`);
    if (dup.length) out.push({ key: "duplicate_docs", label: `${p.id}: the same document more than once`, status: "off", detail: `${dup.length} document${dup.length > 1 ? "s appear" : " appears"} more than once.`, items: dup.slice(0, 50) });
  }
  return out;
}
