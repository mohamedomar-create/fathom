// The Payments upload card: every sheet is read as an Odoo ageing report (Aged Receivable / Payable), a payments list
// (Customer / Vendor Payments), or named as neither. What would block saving is collected in one list.
import type { Grid } from "./extract";
import { readAged, type AgedReport } from "./aged";
import { paymentsHeadingGap, readPayments, type PaymentFinding, type PaymentLine } from "./payments";

export interface PaymentsUploadPlan {
  aged: { sheet: string; report: AgedReport & { asOf: string } }[];
  payments: { sheets: string[]; lines: PaymentLine[]; periods: string[]; findings: PaymentFinding[] };
  /** Sheets that are neither, each with why: never left out quietly. */
  unread: { sheet: string; why: string }[];
  errors: string[];
}

/** opts.currency: the company's currency (an amount in another one, with no company-currency amount, is an error). */
export function planPaymentsUpload(grids: Grid[], opts: { currency?: string } = {}): PaymentsUploadPlan {
  const plan: PaymentsUploadPlan = { aged: [], payments: { sheets: [], lines: [], periods: [], findings: [] }, unread: [], errors: [] };
  const numbers = new Set<string>();
  for (const g of grids) {
    const a = readAged(g);
    if (a) {
      plan.errors.push(...a.errors.map((e) => `${g.name}: ${e}`));
      if (a.asOf) {
        if (plan.aged.some((x) => x.report.side === a.side && x.report.asOf === a.asOf)) plan.errors.push(`There are two Aged ${a.side === "receivable" ? "Receivable" : "Payable"} reports as of ${a.asOf}: upload one.`);
        else plan.aged.push({ sheet: g.name, report: { ...a, asOf: a.asOf } });
      }
      continue;
    }
    const p = readPayments(g, opts);
    if (p) {
      plan.errors.push(...p.errors.map((e) => `${g.name}: ${e}`));
      plan.payments.sheets.push(g.name);
      plan.payments.findings.push(...p.findings);
      for (const l of p.lines) {
        if (l.number && numbers.has(l.number)) { plan.errors.push(`Payment ${l.number} is in two files: upload each payment once.`); continue; }
        if (l.number) numbers.add(l.number);
        plan.payments.lines.push(l);
      }
      continue;
    }
    const filled = g.rows.filter((r) => (r ?? []).some((c) => c !== null && c !== undefined && String(c).trim()));
    if (!filled.length) continue;
    // Odoo adds a "Filters" sheet to every export (Company: …): it holds no figures.
    if (/(^|› )filters$/i.test(g.name.trim()) && filled.length <= 30 && filled.every((r) => r.filter((c) => c !== null && c !== undefined && String(c).trim()).length <= 2)) continue;
    const heads = filled.slice(0, 10).map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c).trim())).filter(Boolean)).sort((a, b) => b.length - a.length)[0] ?? [];
    const seen = heads.length ? `; headings found: ${heads.slice(0, 8).join(", ")}${heads.length > 8 ? ", …" : ""}` : "";
    plan.unread.push({ sheet: g.name, why: (paymentsHeadingGap(g) ?? "not an ageing report (no buckets before a Total column) or a payments list (no Date, Number, Journal, Customer/Vendor and Amount headings)") + seen });
  }
  plan.payments.periods = [...new Set(plan.payments.lines.map((l) => l.period))].sort();
  return plan;
}
