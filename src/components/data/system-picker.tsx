"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAccountingSystem } from "@/app/company/[id]/data/actions";
import { ToCashBook } from "@/components/cash/to-cash-book";
import { useCompany } from "@/lib/company/context";
import { useDict } from "@/lib/i18n/context";

/** "Which accounting system?" for a company that has not said yet: shown once on the Data steps, editors only. */
export function SystemPicker() {
  const c = useCompany();
  const t = useDict().home;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [cash, setCash] = useState(false);
  if (c.basePath === "/demo" || c.readOnly || c.system) return null;
  const pick = (s: "odoo" | "other") => start(async () => { setErr(null); const r = await setAccountingSystem(c.id, s); if (!r.ok) setErr(r.error); else router.refresh(); });
  const card = "rounded-lg border border-line bg-white p-4 text-start transition hover:border-brand disabled:opacity-50";
  return (
    <section className="mb-6 rounded-xl border border-brand/40 bg-brand-bg/40 p-5" data-testid="system-picker">
      <h2 className="mb-3 text-lg font-medium">{t.where}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <button disabled={pending} onClick={() => pick("odoo")} className={card} data-testid="system-odoo"><div className="font-medium">{t.tiles.odoo[0]}</div><div className="mt-1 text-xs text-mute">{t.tiles.odoo[1]}</div></button>
        <button disabled={pending} onClick={() => pick("other")} className={card} data-testid="system-other"><div className="font-medium">{t.tiles.other[0]}</div><div className="mt-1 text-xs text-mute">{t.tiles.other[1]}</div></button>
        <button disabled={pending} onClick={() => setCash(true)} className={card} data-testid="system-cash"><div className="font-medium">{t.tiles.simple[0]}</div><div className="mt-1 text-xs text-mute">{t.tiles.simple[1]}</div></button>
      </div>
      {cash && <div className="mt-3"><ToCashBook companyId={c.id} /></div>}
      {err && <p className="mt-3 rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
    </section>
  );
}
