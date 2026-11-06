"use client";
// Settings ▸ Modules: the areas a company brings (each one a module with the same steps, checks and dashboard), the
// modules it built from its own files, and who sees each one. Admins change it; everyone else reads it.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCompany } from "@/lib/company/context";
import { useT } from "@/lib/i18n/use-t";
import { CATALOG } from "@/lib/modules/catalog";
import { accessEditable, isOn, mayView, type CompanyModule } from "@/lib/modules/company";
import { setModuleAccess, setModuleOn } from "@/app/company/[id]/settings/modules-actions";

const AREAS = ["financials", "sales", "expenses", "purchasing", "inventory", "payments"] as const;

export function ModulesSettings({ people }: { people: { userId: string; label: string }[] }) {
  const c = useCompany();
  const { d, lang } = useT();
  const t = d.mods;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const rows = c.modules ?? [];
  const admin = c.role === "admin" && !c.readOnly;
  const run = (f: () => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => { const r = await f(); setError(r.ok ? null : r.error); if (r.ok) router.refresh(); });
  const toggle = (key: string, on: boolean) => run(() => setModuleOn(c.id, key, on));
  const nameOf = (key: string) => (t.areas as Record<string, string>)[key] ?? (() => { const m = CATALOG.find((x) => x.key === key); return m ? (lang === "ar" ? m.name.ar : m.name.en) : rows.find((r) => r.key === key)?.name ?? key; })();
  const custom = rows.filter((r) => r.kind === "custom");
  const item = (key: string, sub?: string) => {
    const on = isOn(key, rows);
    return (
      <li key={key} className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 first:border-t-0" data-testid={`mod-${key}`} data-on={on}>
        <span><b className="font-medium">{nameOf(key)}</b>{sub && <span className="block text-sm text-mute">{sub}</span>}</span>
        <span className="flex items-center gap-3">
          {on && accessEditable(key) && <Access row={rows.find((r) => r.key === key)} k={key} people={people} admin={admin} onSave={(role, members) => run(() => setModuleAccess(c.id, key, role, members))} />}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={on} disabled={!admin || pending} onChange={(e) => toggle(key, e.target.checked)} data-testid={`mod-toggle-${key}`} />{on ? t.on : t.off}
          </label>
        </span>
      </li>
    );
  };
  return (
    <div data-testid="modules-settings">
      <h1 className="mb-1 text-2xl font-light">{t.title}</h1>
      <p className="mb-5 text-mute">{t.sub}</p>
      {!admin && <p className="mb-4 text-sm text-mute">{t.adminOnly}</p>}
      {error && <p className="mb-4 text-sm text-red" role="alert">{error}</p>}
      <h2 className="t-card mb-2">{t.core}</h2>
      <ul className="mb-6 rounded-lg border border-line bg-white">{AREAS.map((k) => item(k))}</ul>
      <h2 className="t-card mb-2">{t.catalog}</h2>
      <ul className="mb-6 rounded-lg border border-line bg-white">{CATALOG.map((m) => item(m.key, lang === "ar" ? m.owns.ar : m.owns.en))}</ul>
      <h2 className="t-card mb-2">{t.yours}</h2>
      {custom.length ? <ul className="mb-6 rounded-lg border border-line bg-white">{custom.map((r) => item(r.key))}</ul> : <p className="mb-6 text-sm text-mute">{t.noneYours}</p>}
      <p className="text-sm text-mute">{t.howNew}</p>
      {/* What the person themselves can open, so a module hidden from them doesn't look missing. */}
      <p className="mt-2 text-xs text-mute">{t.youSee(CATALOG.filter((m) => isOn(m.key, rows) && mayView(m.key, rows, c.role ?? "viewer", c.userId)).length)}</p>
    </div>
  );
}

function Access({ row, k, people, admin, onSave }: { row?: CompanyModule; k: string; people: { userId: string; label: string }[]; admin: boolean; onSave: (role: "admin" | "editor" | "viewer", members: string[]) => void }) {
  const { d } = useT();
  const t = d.mods;
  const [open, setOpen] = useState(false);
  const role = row?.min_role ?? (k === "hr" || k === "payroll" ? "admin" : "viewer");
  const [r, setR] = useState(role);
  const [who, setWho] = useState<string[]>(row?.members ?? []);
  if (!admin) return <span className="text-xs text-mute">{t.seenBy[role]}</span>;
  if (!open) return <button type="button" className="text-xs text-brand-d underline" onClick={() => setOpen(true)} data-testid={`mod-access-${k}`}>{t.seenBy[role]}{row?.members.length ? ` + ${row.members.length}` : ""}</button>;
  return (
    <span className="flex flex-wrap items-center gap-2 rounded border border-line p-2 text-xs">
      <select value={r} onChange={(e) => setR(e.target.value as typeof r)} className="rounded border border-line px-1 py-0.5" data-testid={`mod-role-${k}`} aria-label={t.who}>
        {(["viewer", "editor", "admin"] as const).map((x) => <option key={x} value={x}>{t.seenBy[x]}</option>)}
      </select>
      {people.length > 0 && <select multiple value={who} onChange={(e) => setWho([...e.target.selectedOptions].map((o) => o.value))} className="max-h-24 rounded border border-line" aria-label={t.named}>
        {people.map((p) => <option key={p.userId} value={p.userId}>{p.label}</option>)}
      </select>}
      <button type="button" className="rounded bg-brand-d px-2 py-1 text-white" onClick={() => { onSave(r, who); setOpen(false); }} data-testid={`mod-access-save-${k}`}>{t.save}</button>
    </span>
  );
}
