"use client";
import { Database, FileSpreadsheet, HelpCircle, Plus, Receipt, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { createCompany, createDemoCompany } from "./actions";
import { useDict } from "@/lib/i18n/context";
import { AreasPicker } from "@/components/settings/areas-picker";
import { suggestSystem, systemFlow, type AcctSystem } from "@/lib/company/system";

type Step = "pick" | "odoo" | "notsure" | "form";

export function AddCompany({ orgs }: { orgs: { id: string; name: string }[] }) {
  const t = useDict().home;
  const [step, setStep] = useState<Step>("pick");
  const [sys, setSys] = useState<AcctSystem>("other");
  const [live, setLive] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const flow = systemFlow(sys, { live });
  const choose = (s: AcctSystem, isLive = false) => { setSys(s); setLive(isLive); setStep("form"); };
  const tiles: { k: "odoo" | "other" | "simple" | "notsure" | "demo"; icon: React.ReactNode; go: () => void }[] = [
    { k: "odoo", icon: <Database className="h-6 w-6" />, go: () => setStep("odoo") },
    { k: "other", icon: <FileSpreadsheet className="h-6 w-6" />, go: () => choose("other") },
    { k: "simple", icon: <Receipt className="h-6 w-6" />, go: () => choose("cash") },
    { k: "notsure", icon: <HelpCircle className="h-6 w-6" />, go: () => setStep("notsure") },
    { k: "demo", icon: <Sparkles className="h-6 w-6" />, go: () => start(async () => { const r = await createDemoCompany(); if (r?.error) setErr(r.error); }) },
  ];
  const card = "rounded-lg border border-line p-4 text-start transition hover:border-brand hover:shadow-sm disabled:opacity-50";
  return (
    <Dialog onOpenChange={(o) => { if (!o) { setStep("pick"); setErr(null); } }}>
      <DialogTrigger className="flex items-center gap-1.5 rounded bg-brand-d px-4 py-2 font-medium text-white hover:brightness-110" data-testid="add-company"><Plus className="h-4 w-4" />{t.add}</DialogTrigger>
      <DialogContent title={t.addTitle} className="w-[min(720px,calc(100vw-24px))] p-6">
        <div className="label">{t.sourceSystem}</div>
        <h2 className="mb-5 text-2xl font-light">{step === "form" ? t.details : step === "odoo" ? t.odooHow.title : step === "notsure" ? t.keep.title : t.where}</h2>
        {step === "pick" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {tiles.map((x) => (
              <button key={x.k} disabled={pending} onClick={x.go} data-testid={`tile-${x.k}`} className={card}>
                <div className="mb-3 text-brand-d">{x.icon}</div>
                <div className="font-medium">{t.tiles[x.k][0]}</div>
                <div className="mt-1 text-xs text-mute">{t.tiles[x.k][1]}</div>
              </button>
            ))}
          </div>
        ) : step === "odoo" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button disabled={pending} onClick={() => choose("odoo")} data-testid="odoo-files" className={card}><div className="font-medium">{t.odooHow.files[0]}</div><div className="mt-1 text-xs text-mute">{t.odooHow.files[1]}</div></button>
            <button disabled={pending} onClick={() => choose("odoo", true)} data-testid="odoo-live" className={card}><div className="font-medium">{t.odooHow.live[0]}</div><div className="mt-1 text-xs text-mute">{t.odooHow.live[1]}</div></button>
            <div className="sm:col-span-2"><button type="button" onClick={() => setStep("pick")} className="rounded px-4 py-2 text-mute hover:bg-band">{t.back}</button></div>
          </div>
        ) : step === "notsure" ? (
          <div className="grid gap-2">
            {(["notebook", "odoo", "software", "accountant"] as const).map((k) => {
              const s = suggestSystem(k);
              return (
                <button key={k} disabled={pending} onClick={() => (s === "odoo" ? setStep("odoo") : choose(s))} data-testid={`keep-${k}`} className={card}>
                  <div className="font-medium">{t.keep[k]}</div>
                  <div className="mt-1 text-xs text-mute">{t.keep.suggest} {t.tiles[s === "cash" ? "simple" : s][0]}</div>
                </button>
              );
            })}
            <div><button type="button" onClick={() => setStep("pick")} className="rounded px-4 py-2 text-mute hover:bg-band">{t.back}</button></div>
          </div>
        ) : (
          <form action={(fd) => start(async () => { setErr(null); const r = await createCompany(fd); if (r?.error) setErr(r.error); })} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="source" value={flow.source} />
            <input type="hidden" name="system" value={sys} />
            {flow.mode === "simple" && <input type="hidden" name="mode" value="simple" />}
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
            {flow.mode !== "simple" && <AreasPicker />}
            <label><span className="label mb-1 block">{t.tax}</span>
              <input name="tax_rate" type="number" step="0.1" defaultValue="22.5" className="w-full rounded border border-line px-3 py-2 outline-none focus:border-brand" /></label>
            <div className="flex items-end justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => setStep("pick")} className="rounded px-4 py-2 text-mute hover:bg-band">{t.back}</button>
              <button disabled={pending} className={cn("rounded bg-brand-d px-4 py-2 font-medium text-white", pending && "opacity-60")}>{pending ? t.creating : t.create}</button>
            </div>
          </form>
        )}
        {pending && step === "pick" && <p className="mt-4 text-sm text-mute">{t.settingUp}</p>}
        {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      </DialogContent>
    </Dialog>
  );
}
