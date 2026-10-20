"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteCompany, saveProfile } from "@/app/company/[id]/settings/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataAndDeletion } from "@/components/settings/data-and-deletion";
import type { ResetPreview } from "@/lib/company/reset";
import { cn } from "@/lib/cn";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export interface ProfileData { id: string; name: string; currency: string; fy_start_month: number; tax_rate: number; industry: string | null; ai_context: Record<string, string>; time_zone?: string | null; books_start?: string | null }
/** Every time zone the browser knows, the company's own first if the list lacks it. */
const zones = (own: string | null | undefined) => {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Africa/Cairo", "UTC"];
  return own && !all.includes(own) ? [own, ...all] : all;
};

export function ProfileForm({ initial, readOnly, canDelete, canExport = true, role, reset }: { initial: ProfileData; readOnly: boolean; canDelete: boolean; canExport?: boolean; role?: "admin" | "editor" | "viewer"; reset?: ResetPreview | null }) {
  const router = useRouter();
  const [v, setV] = useState({ ...initial, tax_rate: Math.round(initial.tax_rate * 10000) / 100, ai: { goals: "", strategy: "", market: "", position: "", other: "", ...initial.ai_context } });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const field = "w-full rounded border border-line px-3 py-2 outline-none focus:border-brand disabled:bg-band";
  const save = () => start(async () => {
    const r = await saveProfile({ companyId: v.id, name: v.name, currency: v.currency, fy_start_month: v.fy_start_month, tax_rate: v.tax_rate, industry: v.industry || null, ai_context: v.ai, ...(v.time_zone !== undefined ? { time_zone: v.time_zone || null } : {}), ...(v.books_start !== undefined ? { books_start: v.books_start || null } : {}) });
    setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error ?? "Could not save" });
    if (r.ok) router.refresh();
  });
  const del = async () => {
    const r = await deleteCompany(v.id);
    if (!r.ok) return r.error ?? "Could not delete the company.";
    router.push("/companies");
  };
  const ai = (k: keyof typeof v.ai, label: string, ph: string) => (
    <label className="block"><span className="label mb-1 block">{label}</span>
      <textarea disabled={readOnly} rows={2} value={v.ai[k]} onChange={(e) => setV({ ...v, ai: { ...v.ai, [k]: e.target.value } })} placeholder={ph} className={field} /></label>
  );
  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="label mb-1 block">Company name</span><input disabled={readOnly} className={field} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label><span className="label mb-1 block">Currency</span><input disabled={readOnly} className={cn(field, "uppercase")} maxLength={6} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} /></label>
        <label><span className="label mb-1 block">Financial year starts</span>
          <select disabled={readOnly} className={field} value={v.fy_start_month} onChange={(e) => setV({ ...v, fy_start_month: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
        <label><span className="label mb-1 block">Corporate tax rate %</span><input disabled={readOnly} type="number" step="0.1" className={field} value={v.tax_rate} onChange={(e) => setV({ ...v, tax_rate: Number(e.target.value) })} /></label>
        <label><span className="label mb-1 block">Time zone</span>
          <select disabled={readOnly} className={field} value={v.time_zone ?? ""} onChange={(e) => setV({ ...v, time_zone: e.target.value || null })} data-testid="time-zone">
            <option value="">None: dates as the Odoo export shows them (recommended)</option>
            {zones(v.time_zone).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
          <span className="mt-1 block text-[12.5px] text-mute">Set this only if your Odoo exports show times in UTC (a delivery done at 11 pm in Cairo shows as 9 pm). Stock records then move to the day they happened in this time zone, which must be the day their journal entry carries.</span></label>
        <label><span className="label mb-1 block">Books start in Odoo</span>
          <input disabled={readOnly} type="month" className={field} value={v.books_start?.slice(0, 7) ?? ""} onChange={(e) => setV({ ...v, books_start: /^\d{4}-\d{2}$/.test(e.target.value) ? `${e.target.value}-01` : null })} data-testid="books-start-profile" />
          <span className="mt-1 block text-[12.5px] text-mute">Everything dated before it (Odoo&apos;s opening entry included) is the opening balance. Empty: every month is trading.</span></label>
        <label><span className="label mb-1 block">Industry</span><input disabled={readOnly} className={field} value={v.industry ?? ""} onChange={(e) => setV({ ...v, industry: e.target.value })} placeholder="e.g. Medical devices distribution" /></label>
      </section>
      <section>
        <h2 className="text-xl font-light">AI business context</h2>
        <p className="mb-4 text-sm text-mute">Helps the AI commentary explain the numbers in your context. Keep it factual; it is only sent when you ask the AI to write commentary.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {ai("goals", "Goals", "e.g. Grow tender revenue 20% this year while keeping GPM above 35%")}
          {ai("strategy", "Strategy", "e.g. Shift mix towards consumables; renegotiate supplier terms")}
          {ai("market", "Market conditions", "e.g. FX volatility raises import costs; public hospitals pay in 90–120 days")}
          {ai("position", "Current position", "e.g. New warehouse opened in March; two sales hires in Q2")}
          <div className="sm:col-span-2">{ai("other", "Other", "Anything else the reader should know")}</div>
        </div>
      </section>
      {!readOnly && (
        <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
          {msg && <span className={cn("me-auto text-sm", msg.ok ? "text-green-d" : "text-red")}>{msg.text}</span>}
          <button onClick={save} disabled={pending} className="rounded bg-brand-d px-5 py-2 font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save profile"}</button>
        </div>
      )}
      {canExport && <section className="rounded-md border border-line p-4">
        <h3 className="font-medium">Your data</h3>
        <p className="mb-3 text-sm text-mute">Download everything stored for this company: settings, every account by month, import history, commentary and reports. The Odoo API key is never included.</p>
        <a href={`/api/export/${initial.id}`} download className="inline-block rounded border border-line px-4 py-2 text-sm hover:bg-band" data-testid="export-company">Download all data (.xlsx)</a>
      </section>}
      {reset && role && <DataAndDeletion companyId={initial.id} name={initial.name} role={role} preview={reset} />}
      {!reset && canDelete && (
        <section className="rounded-md border border-red/30 p-4">
          <h3 className="font-medium text-red">Danger zone</h3>
          <p className="mb-3 text-sm text-mute">Deleting a company removes its data, reports and Odoo connection permanently.</p>
          <ConfirmDialog title="Delete this company?" confirmLabel="Delete company" typeToConfirm={initial.name} typeLabel="Type the company name" onConfirm={del} testId="delete-company-dialog"
            trigger={<button className="rounded border border-red px-4 py-2 text-sm text-red hover:bg-red-bg">Delete this company</button>}>
            <p>This permanently removes <strong>{initial.name}</strong>: all its financial data and history, commentary, reports and shared report links, and its Odoo connection.</p>
            <p className="text-mute">Download the data first if you may need it. This cannot be undone.</p>
          </ConfirmDialog>
        </section>
      )}
    </div>
  );
}
