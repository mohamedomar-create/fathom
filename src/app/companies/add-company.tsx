"use client";
import { Database, FileSpreadsheet, Plus, Sparkles } from "lucide-react";
import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { createCompany, createDemoCompany } from "./actions";

type Src = "upload" | "odoo";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function AddCompany({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [src, setSrc] = useState<Src | null>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const tiles: { k: Src | "demo"; title: string; text: string; icon: React.ReactNode }[] = [
    { k: "upload", title: "Odoo export (Excel / CSV)", text: "Upload Journal Items, Trial Balance or P&L / Balance Sheet exports", icon: <FileSpreadsheet className="h-6 w-6" /> },
    { k: "odoo", title: "Connect Odoo", text: "Pull monthly balances straight from your Odoo database (API key)", icon: <Database className="h-6 w-6" /> },
    { k: "demo", title: "Demo company", text: "A fully loaded sample company to explore every feature", icon: <Sparkles className="h-6 w-6" /> },
  ];
  return (
    <Dialog onOpenChange={(o) => { if (!o) { setSrc(null); setErr(null); } }}>
      <DialogTrigger className="flex items-center gap-1.5 rounded bg-green-d px-4 py-2 font-medium text-white hover:brightness-110" data-testid="add-company"><Plus className="h-4 w-4" />Add company</DialogTrigger>
      <DialogContent title="Add a company" className="w-[min(720px,calc(100vw-24px))] p-6">
        <div className="label">Company source system</div>
        <h2 className="mb-5 text-2xl font-light">{src ? "Company details" : "Where is the data coming from?"}</h2>
        {!src ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {tiles.map((t) => (
              <button key={t.k} disabled={pending} onClick={() => t.k === "demo" ? start(async () => { try { await createDemoCompany(); } catch (e) { setErr(String((e as Error).message)); } }) : setSrc(t.k)}
                className="rounded-lg border border-line p-4 text-left transition hover:border-green hover:shadow-sm disabled:opacity-50">
                <div className="mb-3 text-green-d">{t.icon}</div>
                <div className="font-medium">{t.title}</div>
                <div className="mt-1 text-xs text-mute">{t.text}</div>
              </button>
            ))}
          </div>
        ) : (
          <form action={(fd) => start(async () => { try { await createCompany(fd); } catch (e) { setErr(String((e as Error).message)); } })} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="source" value={src} />
            <label className="sm:col-span-2"><span className="label mb-1 block">Company name</span>
              <input name="name" required maxLength={160} className="w-full rounded border border-line px-3 py-2 outline-none focus:border-green" placeholder="e.g. Nile Medical Supplies" /></label>
            {orgs.length > 1 && (
              <label className="sm:col-span-2"><span className="label mb-1 block">Organisation</span>
                <select name="org_id" className="w-full rounded border border-line px-3 py-2">{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
            )}
            <label><span className="label mb-1 block">Currency</span>
              <input name="currency" defaultValue="EGP" maxLength={6} className="w-full rounded border border-line px-3 py-2 uppercase outline-none focus:border-green" /></label>
            <label><span className="label mb-1 block">Financial year starts</span>
              <select name="fy_start_month" defaultValue="1" className="w-full rounded border border-line px-3 py-2">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
            <label><span className="label mb-1 block">Corporate tax rate %</span>
              <input name="tax_rate" type="number" step="0.1" defaultValue="22.5" className="w-full rounded border border-line px-3 py-2 outline-none focus:border-green" /></label>
            <div className="flex items-end justify-end gap-2 sm:col-span-2">
              <button type="button" onClick={() => setSrc(null)} className="rounded px-4 py-2 text-mute hover:bg-band">Back</button>
              <button disabled={pending} className={cn("rounded bg-green-d px-4 py-2 font-medium text-white", pending && "opacity-60")}>{pending ? "Creating…" : "Create company"}</button>
            </div>
          </form>
        )}
        {pending && !src && <p className="mt-4 text-sm text-mute">Setting up the demo company…</p>}
        {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      </DialogContent>
    </Dialog>
  );
}
