"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteCompany, saveProfile } from "@/app/company/[id]/settings/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataAndDeletion } from "@/components/settings/data-and-deletion";
import { ToCashBook } from "@/components/cash/to-cash-book";
import type { ResetPreview } from "@/lib/company/reset";
import { cn } from "@/lib/cn";
import { useDict } from "@/lib/i18n/context";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export interface ProfileData { id: string; name: string; currency: string; fy_start_month: number; tax_rate: number; industry: string | null; ai_context: Record<string, string>; time_zone?: string | null; books_start?: string | null; vat_rate?: number | null }
/** Every time zone the browser knows, the company's own first if the list lacks it. */
const zones = (own: string | null | undefined) => {
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Africa/Cairo", "UTC"];
  return own && !all.includes(own) ? [own, ...all] : all;
};

export function ProfileForm({ initial, readOnly, canDelete, canExport = true, role, reset, resetNote }: { initial: ProfileData; readOnly: boolean; canDelete: boolean; canExport?: boolean; role?: "admin" | "editor" | "viewer"; reset?: ResetPreview | null; resetNote?: string | null }) {
  const router = useRouter();
  const x = useDict().setx;
  const p = x.profile;
  const [v, setV] = useState({ ...initial, tax_rate: Math.round(initial.tax_rate * 10000) / 100, vat: initial.vat_rate === undefined ? undefined : initial.vat_rate === null ? "" : String(Math.round(initial.vat_rate * 10000) / 100), ai: { goals: "", strategy: "", market: "", position: "", other: "", ...initial.ai_context } });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const field = "w-full rounded border border-line px-3 py-2 outline-none focus:border-brand disabled:bg-band";
  const save = () => start(async () => {
    const r = await saveProfile({ companyId: v.id, name: v.name, currency: v.currency, fy_start_month: v.fy_start_month, tax_rate: v.tax_rate, industry: v.industry || null, ai_context: v.ai, ...(v.time_zone !== undefined ? { time_zone: v.time_zone || null } : {}), ...(v.books_start !== undefined ? { books_start: v.books_start || null } : {}), ...(v.vat !== undefined ? { vat_rate: v.vat === "" ? null : Number(v.vat) } : {}) });
    setMsg(r.ok ? { ok: true, text: p.saved } : { ok: false, text: r.error ?? x.common.couldNotSave });
    if (r.ok) router.refresh();
  });
  const del = async () => {
    const r = await deleteCompany(v.id);
    if (!r.ok) return r.error ?? p.couldNotDelete;
    router.push("/companies");
  };
  const ai = (k: keyof typeof v.ai, label: string, ph: string) => (
    <label className="block"><span className="label mb-1 block">{label}</span>
      <textarea disabled={readOnly} rows={2} value={v.ai[k]} onChange={(e) => setV({ ...v, ai: { ...v.ai, [k]: e.target.value } })} placeholder={ph} className={field} /></label>
  );
  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="label mb-1 block">{p.companyName}</span><input disabled={readOnly} className={field} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label><span className="label mb-1 block">{p.currency}</span><input disabled={readOnly} className={cn(field, "uppercase")} maxLength={6} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} /></label>
        <label><span className="label mb-1 block">{p.fyStarts}</span>
          <select disabled={readOnly} className={field} value={v.fy_start_month} onChange={(e) => setV({ ...v, fy_start_month: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{p.months[i] ?? m}</option>)}</select></label>
        <label><span className="label mb-1 block">{p.taxRate}</span><input disabled={readOnly} type="number" step="0.1" className={field} value={v.tax_rate} onChange={(e) => setV({ ...v, tax_rate: Number(e.target.value) })} /></label>
        {v.vat !== undefined && (
          <label><span className="label mb-1 block">{p.vatRate}</span><input disabled={readOnly} type="number" step="0.1" min={0} max={50} placeholder="14" className={field} value={v.vat} onChange={(e) => setV({ ...v, vat: e.target.value })} data-testid="vat-rate" />
            <span className="mt-1 block text-xs text-mute">{p.vatNote}</span></label>
        )}
        <label><span className="label mb-1 block">{p.timeZone}</span>
          <select disabled={readOnly} className={field} value={v.time_zone ?? ""} onChange={(e) => setV({ ...v, time_zone: e.target.value || null })} data-testid="time-zone">
            <option value="">{p.tzNone}</option>
            {zones(v.time_zone).map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </select>
          <span className="mt-1 block text-[12.5px] text-mute">{p.tzNote}</span></label>
        <label><span className="label mb-1 block">{p.booksStart}</span>
          <input disabled={readOnly} type="month" className={field} value={v.books_start?.slice(0, 7) ?? ""} onChange={(e) => setV({ ...v, books_start: /^\d{4}-\d{2}$/.test(e.target.value) ? `${e.target.value}-01` : null })} data-testid="books-start-profile" />
          <span className="mt-1 block text-[12.5px] text-mute">{p.booksNote}</span></label>
        <label><span className="label mb-1 block">{p.industry}</span><input disabled={readOnly} className={field} value={v.industry ?? ""} onChange={(e) => setV({ ...v, industry: e.target.value })} placeholder={p.industryPh} /></label>
      </section>
      <section>
        <h2 className="text-xl font-light">{p.aiTitle}</h2>
        <p className="mb-4 text-sm text-mute">{p.aiIntro}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {ai("goals", p.goals, p.goalsPh)}
          {ai("strategy", p.strategy, p.strategyPh)}
          {ai("market", p.market, p.marketPh)}
          {ai("position", p.position, p.positionPh)}
          <div className="sm:col-span-2">{ai("other", p.other, p.otherPh)}</div>
        </div>
      </section>
      {!readOnly && (
        <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
          {msg && <span className={cn("me-auto text-sm", msg.ok ? "text-green-d" : "text-red")}>{msg.text}</span>}
          <button onClick={save} disabled={pending} className="rounded bg-brand-d px-5 py-2 font-medium text-white disabled:opacity-50">{pending ? x.common.saving : p.saveProfile}</button>
        </div>
      )}
      {canExport && <section className="rounded-md border border-line p-4">
        <h3 className="font-medium">{p.yourData}</h3>
        <p className="mb-3 text-sm text-mute">{p.yourDataText}</p>
        <a href={`/api/export/${initial.id}`} download className="inline-block rounded border border-line px-4 py-2 text-sm hover:bg-band" data-testid="export-company">{p.downloadAll}</a>
      </section>}
      {!readOnly && <ToCashBook companyId={initial.id} />}
      {reset && role && <DataAndDeletion companyId={initial.id} name={initial.name} role={role} preview={reset} />}
      {!reset && resetNote && role !== "viewer" && (
        <p className="rounded-md border border-amber bg-amber/10 p-3 text-sm" role="status" data-testid="reset-unavailable"><b className="font-medium">{p.dataDeletion}</b> {p.resetNotes[resetNote] ?? resetNote}</p>
      )}
      {!reset && canDelete && (
        <section className="rounded-md border border-red/30 p-4">
          <h3 className="font-medium text-red">{p.dangerZone}</h3>
          <p className="mb-3 text-sm text-mute">{p.dangerText}</p>
          <ConfirmDialog reauth title={p.deleteTitle} confirmLabel={p.deleteConfirm} typeToConfirm={initial.name} typeLabel={p.typeName} onConfirm={del} testId="delete-company-dialog"
            trigger={<button className="rounded border border-red px-4 py-2 text-sm text-red hover:bg-red-bg">{p.deleteBtn}</button>}>
            <p>{p.deleteA}<strong>{initial.name}</strong>{p.deleteB}</p>
            <p className="text-mute">{p.deleteHidden}</p>
          </ConfirmDialog>
        </section>
      )}
    </div>
  );
}
