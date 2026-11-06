// From the intake's records to the lines each module's own save takes (sales lines, expense lines, payments, the shared
// store for new modules), and to AQL360's template for the preview and the download. Nothing is recomputed here: an
// amount, a date or a name is carried as read, or the record would have been rejected.
import type { SalesLine } from "@/lib/ingest/sales";
import { NO_CUSTOMER, splitLabel } from "@/lib/ingest/sales";
import type { ExpenseLine } from "@/lib/ingest/expenses";
import { NO_SUPPLIER } from "@/lib/ingest/expenses";
import type { PaymentLine } from "@/lib/ingest/payments";
import { seriesOf } from "@/lib/engine/series";
import type { Grid } from "@/lib/ingest/extract";
import type { ModuleDef } from "@/lib/modules/types";
import { templateGrid, type Row } from "@/lib/modules/template";
import type { Rec } from "./records";

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const n = (v: unknown) => (typeof v === "number" ? v : null);
const day = (r: Rec) => (typeof r.date === "string" ? r.date : null);
const period = (r: Rec) => r.__period ?? (day(r)?.slice(0, 7) ?? "");

export function toSalesLines(records: Rec[], sheet: string): SalesLine[] {
  return records.map((r) => {
    const label = s(r.product);
    const split = label ? splitLabel(label) : null;
    const doc = s(r.doc);
    return {
      day: day(r), period: period(r), doc, series: seriesOf(doc), customer: s(r.customer) || NO_CUSTOMER,
      product: split?.product ?? "No description", category: s(r.category) || split?.category || "No category", salesperson: s(r.salesperson),
      qty: n(r.qty), amount: n(r.untaxed) ?? n(r.total) ?? 0, cost: n(r.cost), src: { sheet, row: r.__row },
    };
  });
}

export function toExpenseLines(records: Rec[], sheet: string): ExpenseLine[] {
  return records.map((r) => {
    const doc = s(r.doc);
    return {
      day: day(r), period: period(r), doc, series: seriesOf(doc), supplier: s(r.supplier) || NO_SUPPLIER,
      account: s(r.account) || s(r.category) || s(r.label), cls: null, category: s(r.category) || s(r.account), label: s(r.label),
      amount: n(r.untaxed) ?? n(r.total) ?? 0, src: { sheet, row: r.__row },
    };
  });
}

const IN = /^(in|inbound|receive|received|incoming|customer payment|وارد|استلام|تحصيل|مقبوض)/i;
const OUT = /^(out|outbound|send|sent|outgoing|vendor payment|supplier payment|صادر|إرسال|ارسال|دفع|سداد)/i;
const PROCESS = /process|pending|in transit|cheque|check|قيد|تحت التحصيل/i;
/** Signed in the company's currency: positive received, negative paid. The payment type says which; else the sign. */
export function toPaymentLines(records: Rec[], currency: string): PaymentLine[] {
  return records.map((r) => {
    const raw = n(r.amount) ?? 0;
    const type = s(r.type);
    const dir: "in" | "out" = IN.test(type) ? "in" : OUT.test(type) ? "out" : raw < 0 ? "out" : "in";
    const amount = dir === "out" ? -Math.abs(raw) : Math.abs(raw);
    return { day: day(r) ?? "", period: period(r), number: s(r.number), journal: s(r.journal), method: s(r.method), partner: s(r.partner), direction: dir, amount, currency, amountCurrency: amount, state: PROCESS.test(`${s(r.method)} ${s(r.state)}`) ? "in_process" : "paid", row: r.__row };
  });
}

export interface GenericRow { period: string; day: string | null; doc: string; partner: string; amount: number; qty: number | null; data: Record<string, string | number> }
/** A new module's row for the shared store: the common columns typed, every other field kept as read. */
export function toGenericRows(records: Rec[], m: ModuleDef): GenericRow[] {
  const qtyField = m.fields.find((f) => f.type === "qty")?.key;
  const common = new Set([m.doc, m.party, m.date, m.amount, qtyField].filter(Boolean) as string[]);
  return records.map((r) => {
    const data: Record<string, string | number> = {};
    for (const f of m.fields) if (!common.has(f.key) && r[f.key] !== undefined && r[f.key] !== null) data[f.key] = r[f.key] as string | number;
    const d = m.date && typeof r[m.date] === "string" ? (r[m.date] as string) : null;
    return { period: r.__period ?? d?.slice(0, 7) ?? "", day: d, doc: m.doc ? s(r[m.doc]) : "", partner: m.party ? s(r[m.party]) : "", amount: n(r[m.amount]) ?? 0, qty: qtyField ? n(r[qtyField]) : null, data };
  });
}

/** The records in AQL360's template for the module (the preview, and the file the person can download). */
export function templateOf(m: ModuleDef, records: Rec[]): Grid {
  return templateGrid(m, records.map((r) => Object.fromEntries(m.fields.map((f) => [f.key, (r[f.key] ?? null) as Row[string]]))));
}
