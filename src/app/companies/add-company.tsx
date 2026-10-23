"use client";
import { Database, FileSpreadsheet, Plus, Receipt, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { createCompany, createDemoCompany } from "./actions";
import { useDict } from "@/lib/i18n/context";

type Src = "upload" | "odoo" | "simple";

export function AddCompany({ orgs }: { orgs: { id: string; name: string }[] }) {
  const t = useDict().home;
  const [src, setSrc] = useState<Src | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const tiles: { k: Src | "demo"; title: string; text: string; icon: React.ReactNode }[] = [
    { k: "simple", title: t.tiles.simple[0], text: t.tiles.simple[1], icon: <Receipt className="h-6 w-6" /> },
    { k: "upload", title: t.tiles.upload[0], text: t.tiles.upload[1], icon: <FileSpreadsheet className="h-6 w-6" /> },
    { k: "odoo", title: t.tiles.odoo[0], text: t.tiles.odoo[1], icon: <Database className="h-6 w-6" /> },
    { k: "demo", title: t.tiles.demo[0], text: t.tiles.demo[1], icon: <Sparkles className="h-6 w-6" /> },
  ];
  return (
    <Dialog onOpenChange={(o) => { if (!o) { setSrc(null); setErr(null); } }}>
      <DialogTrigger className="flex items-center gap-1.5 rounded bg-brand-d px-4 py-2 font-medium text-white hover:brightness-110" data-testid="add-company"><Plus className="h-4 w-4" />{t.add}</DialogTrigger>
      <DialogContent title={t.addTitle} className="w-[min(720px,calc(100vw-24px))] p-6">
        <div className="label">{t.sourceSystem}</div>
        <h2 className="mb-5 text-2xl font-light">{src ? t.details : t.where}</h2>
        {!src ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {tiles.map((t) => (
              <button key={t.k} disabled={pending} onClick={() => t.k === "demo" ? start(async () => { const r = await createDemoCompany(); if (r?.error) setErr(r.error); }) : setSrc(t.k)}
                data-testid={`tile-${t.k}`} className="rounded-lg border border-line p-4 text-start transition hover:border-brand hover:shadow-sm disabled:opacity-50">
                <div className="mb-3 text-brand-d">{t.icon}</div>
                <div className="font-medium">{t.title}</div>
                <div className="mt-1 text-xs text-mute">{t.text}</div>
              </button>
            ))}
          </div>
        ) : (
          <form action={(fd) => start(async () => { setErr(null); const r = await createCompany(fd); if (r?.error) setErr(r.error); })} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="source" value={src === "simple" ? "upload" : src} />
            {src === "simple" && <input type="hidden" name="mode" value="simple" />}
            <label className="sm:col-span-2"><span className="label mb-1 block">{t.name}</span>
              <input name="name" required maxLength={160} className="w-full rounded border border-line px-3 py-2 outline-none focus:border-brand" placeholder={t.namePlaceholder} /></label>
            {orgs.length > 1 && (
              <label className="sm:col-span-2"><span className="label mb-1 block">{t.org}</span>
                <select name="org_id" className="w-full rounded border border-line px-3 py-2">{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            )}
            <label><span className="label mb-1 block">{t.currency}</span>
              <input name="currency" defaultValue="EGP" maxLength={6} className="w-full rounded border border-line px-3 py-2 uppercase outline-none focus:border-brand" /></label>
            <label><span className="label mb-1 block">{t.fyStarts}</span>
              <select name="fy_start_month" defaultValue="1" className="w-full rounded border border-line px-3 py-2">{t.months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
            <label><span className="label mb-1 block">{t.tax}</span>
              <input name="tax_rate" type="number" step="0.1" defaultValue="22.5" className="w-full rounded border border-line px-3 py-2 outline-none focus:border-brand" /></label>
            <div className="flex items-end justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => setSrc(null)} className="rounded px-4 py-2 text-mute hover:bg-band">{t.back}</button>
              <button disabled={pending} className={cn("rounded bg-brand-d px-4 py-2 font-medium text-white", pending && "opacity-60")}>{pending ? t.creating : t.create}</button>
            </div>
          </form>
        )}
        {pending && !src && <p className="mt-4 text-sm text-mute">{t.settingUp}</p>}
        {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      </DialogContent>
    </Dialog>
  );
}
