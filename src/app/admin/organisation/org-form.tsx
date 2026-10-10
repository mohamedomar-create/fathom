"use client";
import { useState, useTransition } from "react";
import type { OrganizationRow } from "@/lib/supabase/database.types";
import { saveOrg } from "../actions";

export function OrgForm({ org }: { org: OrganizationRow }) {
  const [v, setV] = useState({ name: org.name, brand_colour: org.brand_colour ?? "#0B6E70", logo_url: org.logo_url ?? "", disclaimer: org.disclaimer, report_footer: org.report_footer ?? "" });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const field = "w-full rounded border border-line px-3 py-2 outline-none focus:border-brand";
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveOrg({ orgId: org.id, ...v, report_footer: v.report_footer || null }); setMsg(r.ok ? "Saved." : r.error ?? "Error"); }); }}>
      <label className="block"><span className="label mb-1 block">Organisation name</span><input className={field} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
      <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
        <label className="block"><span className="label mb-1 block">Brand colour</span>
          <span className="flex items-center gap-2"><input type="color" value={v.brand_colour} onChange={(e) => setV({ ...v, brand_colour: e.target.value })} className="h-9 w-12 rounded border border-line" /><code className="text-xs">{v.brand_colour}</code></span></label>
        <label className="block"><span className="label mb-1 block">Logo URL (PNG/SVG, shown on reports)</span><input className={field} value={v.logo_url} onChange={(e) => setV({ ...v, logo_url: e.target.value })} placeholder="https://…/logo.png" /></label>
      </div>
      <label className="block"><span className="label mb-1 block">Report footer</span><input className={field} maxLength={200} value={v.report_footer} onChange={(e) => setV({ ...v, report_footer: e.target.value })} placeholder="Company Name (Period) - Prepared by …" /></label>
      <label className="block"><span className="label mb-1 block">Report disclaimer</span><textarea rows={4} maxLength={1500} className={field} value={v.disclaimer} onChange={(e) => setV({ ...v, disclaimer: e.target.value })} />
        <span className="text-xs text-mute">{1500 - v.disclaimer.length} characters remaining</span></label>
      <div className="flex items-center justify-end gap-3">{msg && <span className="mr-auto text-sm text-green-d">{msg}</span>}<button disabled={pending} className="rounded bg-brand-d px-5 py-2 font-medium text-white">{pending ? "Saving…" : "Save"}</button></div>
    </form>
  );
}
