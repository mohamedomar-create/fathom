"use client";
// In Smart upload: a table of an area the company hasn't opened ("This looks like HR data. Open the HR module?"), and a
// table no module knows ("Make a module from this table"). Nothing opens or saves without the person's click.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useCompany } from "@/lib/company/context";
import { useT } from "@/lib/i18n/use-t";
import { CATALOG_KEYS } from "@/lib/modules/catalog";
import { isOn } from "@/lib/modules/company";
import { moduleByKey } from "@/lib/modules/registry";
import { moduleKey, suggestSpec } from "@/lib/modules/suggest";
import { MODULE_KEYS } from "@/lib/modules/registry";
import type { ModuleSpec } from "@/lib/modules/spec";
import type { Piece } from "@/lib/intake/split";
import { saveCustomModule, setModuleOn } from "@/app/company/[id]/settings/modules-actions";

/** A catalog or custom module the company has not opened yet: its tables wait until it is. */
export function useNeedsOpening() {
  const c = useCompany();
  return (key: string | null | undefined) => !!key && (CATALOG_KEYS.includes(key) || key.startsWith("c_")) && !isOn(key, c.modules ?? []);
}

export function ModuleOffer({ module }: { module: string }) {
  const c = useCompany();
  const { d, lang } = useT();
  const t = d.mods;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const m = moduleByKey(module);
  const name = m ? (lang === "ar" ? m.name.ar : m.name.en) : module;
  return (
    <div className="mt-3 rounded border border-brand/50 bg-brand-bg/20 px-3 py-2 text-sm" data-testid="module-offer">
      <p className="mb-2">{t.offer(name)}</p>
      {c.role === "admin" && !c.readOnly ? (
        <button type="button" disabled={pending} className="rounded bg-brand-d px-3 py-1 text-white" data-testid="module-offer-open"
          onClick={() => start(async () => { const r = await setModuleOn(c.id, module, true); if (r.ok) router.refresh(); else setError(r.error); })}>{t.open}</button>
      ) : <p className="text-mute">{t.askAdmin}</p>}
      {error && <p className="mt-1 text-red" role="alert">{error}</p>}
    </div>
  );
}

export function ModuleBuilder({ piece, onBuilt }: { piece: Piece; onBuilt: (key: string) => void }) {
  const c = useCompany();
  const { d } = useT();
  const t = d.mods;
  const router = useRouter();
  // Keys already used by this company's modules and the built-in ones: a new module never overwrites one of them.
  const taken = useMemo(() => [...MODULE_KEYS, ...(c.modules ?? []).map((m) => m.key)], [c.modules]);
  const draft = useMemo(() => suggestSpec(piece, taken), [piece, taken]);
  const [open, setOpen] = useState(false);
  const [spec, setSpec] = useState<ModuleSpec>(draft);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (c.role !== "admin" || c.readOnly) return null;
  if (!open) return <button type="button" className="mt-3 rounded border border-line bg-white px-3 py-1 text-sm" data-testid="module-build" onClick={() => setOpen(true)}>{t.build}</button>;
  const setField = (i: number, patch: Partial<ModuleSpec["fields"][number]>) => setSpec((s) => ({ ...s, fields: s.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  const toggle = (list: "dimensions" | "measures", key: string, on: boolean) => setSpec((s) => ({ ...s, [list]: on ? [...new Set([...(s[list] ?? []), key])] : (s[list] ?? []).filter((k) => k !== key) }));
  const required = new Set(spec.required.flat());
  return (
    <div className="mt-3 rounded border border-line bg-white px-3 py-3 text-sm" data-testid="module-builder">
      <p className="mb-2 text-mute">{t.buildSub}</p>
      <div className="mb-3 flex flex-wrap gap-3">
        <label>{t.name} <input className="ms-1 rounded border border-line px-2 py-1" value={spec.name.en} maxLength={60} data-testid="module-build-name"
          onChange={(e) => { const en = e.target.value; setSpec((s) => ({ ...s, name: { ...s.name, en }, key: moduleKey(en, taken) })); }} /></label>
        <label>{t.nameAr} <input className="ms-1 rounded border border-line px-2 py-1" value={spec.name.ar} maxLength={60} dir="rtl" onChange={(e) => setSpec((s) => ({ ...s, name: { ...s.name, ar: e.target.value } }))} /></label>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-band"><tr>{[d.ink.column, t.fieldType, t.requiredField, t.dimension, t.measure].map((h) => <th key={h} className="px-2 py-1 text-start font-medium">{h}</th>)}</tr></thead>
          <tbody>{spec.fields.map((f, i) => (
            <tr key={f.key} className="border-t border-line">
              <td className="px-2 py-1">{f.heading}</td>
              <td className="px-2 py-1"><select value={f.type} className="rounded border border-line px-1" aria-label={`${t.fieldType} ${f.heading}`}
                onChange={(e) => setField(i, { type: e.target.value as typeof f.type })}>{Object.entries(t.types).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
              <td className="px-2 py-1"><input type="checkbox" aria-label={`${t.requiredField} ${f.heading}`} checked={required.has(f.key)}
                onChange={(e) => setSpec((s) => ({ ...s, required: e.target.checked ? [...s.required, [f.key]] : s.required.map((g) => g.filter((k) => k !== f.key)).filter((g) => g.length) }))} /></td>
              <td className="px-2 py-1"><input type="checkbox" aria-label={`${t.dimension} ${f.heading}`} checked={(spec.dimensions ?? []).includes(f.key)} onChange={(e) => toggle("dimensions", f.key, e.target.checked)} /></td>
              <td className="px-2 py-1"><input type="checkbox" aria-label={`${t.measure} ${f.heading}`} checked={(spec.measures ?? []).includes(f.key)} disabled={f.key === spec.amount} onChange={(e) => toggle("measures", f.key, e.target.checked)} /></td>
            </tr>))}</tbody>
        </table>
      </div>
      <button type="button" disabled={pending} className="mt-3 rounded bg-brand-d px-3 py-1 text-white" data-testid="module-build-create"
        onClick={() => start(async () => {
          // The money field stays the amount; a date field picked as the module's date puts rows in months.
          const date = spec.fields.find((f) => f.type === "date")?.key;
          const amount = spec.fields.find((f) => f.key === spec.amount && f.type === "money") ? spec.amount : spec.fields.find((f) => f.type === "money")?.key ?? spec.amount;
          const final: ModuleSpec = { ...spec, amount, ...(date ? { date } : {}), required: spec.required.length ? spec.required : [[spec.fields[0].key]] };
          const r = await saveCustomModule(c.id, final, true);
          if (!r.ok) { setError(r.error); return; }
          router.refresh();
          onBuilt(final.key);
        })}>{t.create}</button>
      {error && <p className="mt-1 text-red" role="alert">{error}</p>}
    </div>
  );
}
