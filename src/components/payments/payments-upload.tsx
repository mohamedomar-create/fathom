"use client";
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { readWorkbooks } from "@/lib/ingest/read";
import type { Grid } from "@/lib/ingest/extract";
import { planPaymentsUpload } from "@/lib/ingest/payments-upload";
import { addPaymentLines, saveAgedReport, startPaymentBatch } from "@/app/company/[id]/settings/payments-actions";
import { WizardNav, WizardSteps, WizardTitle } from "@/components/upload/wizard-shell";
import { useCompany } from "@/lib/company/context";

const fmt = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CHUNK = 3000;

/**
 * Odoo's Aged Receivable / Aged Payable and its Customer / Vendor Payments lists, uploaded together: each file is read and
 * checked in the page (every partner's documents must add up to its total, every payment counted once), then saved.
 */
export function PaymentsUpload({ companyId, basePath, onBack }: { companyId: string; basePath: string; onBack: () => void }) {
  const [grids, setGrids] = useState<Grid[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [acceptUnread, setAcceptUnread] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const currency = useCompany().settings.currency;
  const plan = useMemo(() => (grids ? planPaymentsUpload(grids, { currency }) : null), [grids, currency]);
  const nothing = plan && !plan.aged.length && !plan.payments.lines.length;

  async function onFiles(fs: File[]) {
    setErr(null);
    if (!fs.length) return;
    if (fs.some((f) => !/\.(xlsx|xls|csv)$/i.test(f.name))) { setErr("Choose Excel (.xlsx) or CSV files exported from Odoo."); return; }
    setBusy(true);
    try {
      const gs = await readWorkbooks(await Promise.all(fs.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() }))));
      setGrids(gs);
    } catch (e) { setErr((e as Error).message || "The files could not be read."); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!plan) return;
    setBusy(true); setErr(null);
    try {
      for (const a of plan.aged) {
        const r = a.report;
        const res = await saveAgedReport({ companyId, side: r.side, asOf: r.asOf, buckets: r.buckets, total: r.total, findings: r.findings, filename: a.sheet.slice(0, 300),
          items: r.items.map((i) => ({ partner: i.partner, ref: i.ref, memo: i.memo, day: i.day, amounts: i.amounts, total: i.total })) });
        if (!res.ok) throw new Error(res.error);
      }
      const ls = plan.payments.lines;
      if (ls.length) {
        const b = await startPaymentBatch(companyId, plan.payments.periods, plan.payments.sheets.join(", ").slice(0, 300));
        if (!b.ok) throw new Error(b.error);
        for (let i = 0; i < ls.length; i += CHUNK) {
          const part = ls.slice(i, i + CHUNK).map((l) => ({ day: l.day, period: l.period, number: l.number, journal: l.journal, method: l.method, partner: l.partner, direction: l.direction, amount: l.amount, currency: l.currency, amount_currency: l.amountCurrency, state: l.state }));
          const res = await addPaymentLines(companyId, b.batch, part, i + CHUNK >= ls.length);
          if (!res.ok) throw new Error(res.error);
        }
      }
      setDone([plan.aged.map((a) => `Aged ${a.report.side === "receivable" ? "Receivable" : "Payable"} as of ${a.report.asOf}`).join(", "), ls.length ? `${ls.length} payments` : ""].filter(Boolean).join(" and "));
    } catch (e) { setErr((e as Error).message || "Saving failed."); }
    finally { setBusy(false); }
  }

  if (done) return (
    <div data-testid="done-step">
      <WizardSteps at="done" />
      <WizardTitle title="Saved" hint={`${done}.`} />
      <a href={`${basePath}/payments`} className="inline-block rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="done-see">See my receivables and payments</a>
    </div>
  );

  if (!plan) return (
    <div data-testid="payments-upload">
      <WizardSteps at="upload" />
      <WizardTitle title="Upload your files" hint="Odoo's Aged Receivable, Aged Payable, and Customer / Vendor Payments: one file or several together." />
      <button onClick={() => input.current?.click()} disabled={busy} className="flex w-full max-w-2xl flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line p-10 text-mute hover:border-brand" data-testid="dropzone">
        <Upload className="h-8 w-8" />{busy ? "Reading…" : "Choose files"}
      </button>
      <input ref={input} type="file" multiple accept=".xlsx,.xls,.csv" className="hidden" data-testid="file-input" onChange={(e) => onFiles([...(e.target.files ?? [])])} />
      {err && <p className="mt-4 text-red" data-testid="payments-error">{err}</p>}
      <WizardNav onBack={onBack} />
    </div>
  );

  return (
    <div data-testid="payments-check">
      <WizardSteps at="check" />
      <WizardTitle title="Check what iReport read" hint="Every partner's documents are added up and checked against the report's own totals." />
      <ul className="max-w-4xl space-y-3">
        {plan.aged.map((a) => (
          <li key={a.sheet} className="rounded-lg border border-line p-4" data-testid={`aged-${a.report.side}`}>
            <p className="flex items-center gap-2 font-medium"><FileSpreadsheet className="h-4 w-4" />Aged {a.report.side === "receivable" ? "Receivable" : "Payable"} as of {a.report.asOf}</p>
            <p className="text-[14px] text-mute">{a.report.partners.length} partners, {a.report.items.length} open documents, total <span data-testid={`aged-${a.report.side}-total`}>{fmt(a.report.total.total)}</span></p>
            {a.report.findings.length > 0 && <ul className="mt-2 list-disc ps-5 text-[14px] text-ink">{a.report.findings.map((f) => <li key={f.id}>{f.message}</li>)}</ul>}
          </li>
        ))}
        {plan.payments.lines.length > 0 && (
          <li className="rounded-lg border border-line p-4" data-testid="payments-read">
            <p className="flex items-center gap-2 font-medium"><FileSpreadsheet className="h-4 w-4" />Payments, {plan.payments.periods.join(", ")}</p>
            <p className="text-[14px] text-mute">
              {plan.payments.lines.filter((l) => l.direction === "in").length} received, <span data-testid="payments-in">{fmt(plan.payments.lines.filter((l) => l.direction === "in").reduce((s, l) => s + l.amount, 0))}</span>;{" "}
              {plan.payments.lines.filter((l) => l.direction === "out").length} paid, <span data-testid="payments-out">{fmt(-plan.payments.lines.filter((l) => l.direction === "out").reduce((s, l) => s + l.amount, 0))}</span>
            </p>
            {plan.payments.findings.length > 0 && <ul className="mt-2 list-disc ps-5 text-[14px] text-ink">{plan.payments.findings.map((f, i) => <li key={i}>{f.message}</li>)}</ul>}
          </li>
        )}
        {plan.unread.length > 0 && (
          <li className="rounded-lg border-2 border-red p-4" data-testid="payments-unread">
            <p className="flex items-center gap-2 font-medium text-red"><AlertTriangle className="h-4 w-4" />Not read: nothing from {plan.unread.length > 1 ? "these sheets" : "this sheet"} will be saved</p>
            <ul className="mt-1 list-disc ps-5 text-[14px]">{plan.unread.map((u) => <li key={u.sheet}><b>{u.sheet}</b>: {u.why}.</li>)}</ul>
            <label className="mt-2 flex items-center gap-2 text-[14px]"><input type="checkbox" checked={acceptUnread} onChange={(e) => setAcceptUnread(e.target.checked)} data-testid="accept-unread" />Save without {plan.unread.length > 1 ? "these sheets" : "this sheet"}</label>
          </li>
        )}
      </ul>
      {(plan.errors.length > 0 || nothing) && (
        <div className="mt-4 max-w-4xl rounded-lg bg-red-bg p-4 text-red" data-testid="payments-errors">
          <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />{nothing ? "No ageing report or payments list in these files." : "Fix these in Odoo and export again:"}</p>
          <ul className="mt-1 list-disc ps-5 text-[14px]">{plan.errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {err && <p className="mt-4 text-red" data-testid="payments-error">{err}</p>}
      <WizardNav onBack={() => { setGrids(null); setAcceptUnread(false); }} back="Choose other files" next="Save" onNext={save} busy={busy} disabled={!!nothing || plan.errors.length > 0 || (plan.unread.length > 0 && !acceptUnread)} nextTestId="save-payments" />
    </div>
  );
}
