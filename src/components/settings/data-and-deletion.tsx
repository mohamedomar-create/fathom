"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clearData, deleteCompanyFully } from "@/app/company/[id]/settings/reset-actions";
import { confirmCount, type ResetModuleView, type ResetPreview, type ResetScope } from "@/lib/company/reset";
import { useDict } from "@/lib/i18n/context";

const n = (x: number) => x.toLocaleString("en-US");
const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "");

function WhatGoes({ m }: { m: ResetModuleView }) {
  const r = useDict().setx.reset;
  return (
    <>
      <ul className="list-disc ps-5" data-testid={`reset-tables-${m.key}`}>{m.tables.map((t) => <li key={t.key}><span className="num">{n(t.n)}</span> {r.tables[t.key] ?? t.label}</li>)}</ul>
      {m.uploads.length > 0 && (
        <div>
          <p className="label mt-2">{r.fromUploads}</p>
          <ul className="max-h-32 overflow-auto text-[13px] text-mute">{m.uploads.slice(0, 12).map((u, i) => <li key={i} className="truncate">{u.name} {day(u.at) && <span>· {day(u.at)}</span>}</li>)}{m.uploads.length > 12 && <li>{r.andMore(m.uploads.length - 12)}</li>}</ul>
        </div>
      )}
      <p className="text-mute">{r.modules[m.key]?.[1] ?? m.keeps}</p>
    </>
  );
}

/**
 * Clear one module's imported data, clear all of it (the company and its settings stay), or delete the company. Each
 * shows exactly what will be removed before it runs; the database removes nothing if the counts changed meanwhile.
 */
export function DataAndDeletion({ companyId, name, role, preview }: { companyId: string; name: string; role: "admin" | "editor" | "viewer"; preview: ResetPreview }) {
  const router = useRouter();
  const x = useDict().setx;
  const t = x.reset;
  const p = x.profile;
  const [done, setDone] = useState<string | null>(null);
  const canClear = role !== "viewer";
  const isAdmin = role === "admin";
  const label = (m: ResetModuleView) => t.modules[m.key]?.[0] ?? m.label;
  const clear = (scope: ResetScope, label: string) => async () => {
    const r = await clearData(companyId, scope, confirmCount(preview, scope));
    if (!r.ok) return r.error;
    setDone(t.cleared(label, n(r.removed), r.filesLeft ?? 0));
    router.refresh();
  };
  const del = async () => {
    const r = await deleteCompanyFully(companyId, name);
    if (!r.ok) return r.error;
    router.push("/companies");
  };
  const files = preview.files.length;

  return (
    <section className="rounded-md border border-red/30 p-4" data-testid="data-and-deletion">
      <h3 className="font-medium text-red">{t.title}</h3>
      <p className="mb-3 text-sm text-mute">{t.intro}</p>
      {done && (
        <p className="mb-3 rounded border border-line bg-panel p-2 text-[13.5px]" role="status">
          {done} {t.ready} <Link className="underline" href={`/company/${companyId}/data`}>{t.stepsLink}</Link>.
        </p>
      )}
      <ul className="divide-y divide-line text-sm" data-testid="reset-modules">
        {preview.modules.map((m) => (
          <li key={m.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div>{label(m)}</div>
              <div className="text-xs text-mute">{m.records ? t.recordsUploads(n(m.records), m.uploads.length) : t.nothing}</div>
            </div>
            {canClear && m.records > 0 && (
              <ConfirmDialog title={t.clearTitle(label(m))} confirmLabel={t.clear} onConfirm={clear(m.key, label(m))} testId={`clear-${m.key}-dialog`}
                trigger={<button className="rounded border border-red px-3 py-1 text-sm text-red hover:bg-red-bg">{t.clear}</button>}>
                <p>{t.removesFromA}<strong>{name}</strong>:</p>
                <WhatGoes m={m} />
              </ConfirmDialog>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && preview.total > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <ConfirmDialog reauth title={t.allTitle} confirmLabel={t.allConfirm} typeToConfirm="CLEAR" onConfirm={clear("all", t.allLabel)} testId="clear-all-dialog"
            trigger={<button className="rounded border border-red px-4 py-2 text-sm text-red hover:bg-red-bg">{t.allBtn}</button>}>
            <p>{t.allA}<strong>{n(preview.total)}</strong>{t.allB}<strong>{name}</strong>{t.allFiles(files)}:</p>
            <ul className="list-disc ps-5">{preview.modules.filter((m) => m.records).map((m) => <li key={m.key}>{label(m)}: {n(m.records)}</li>)}</ul>
            <p className="text-mute">{t.allStays}</p>
          </ConfirmDialog>
        </div>
      )}
      {isAdmin && (
        <div className="mt-4 border-t border-line pt-3">
          <ConfirmDialog reauth title={p.deleteTitle} confirmLabel={p.deleteConfirm} typeToConfirm={name} typeLabel={p.typeName} onConfirm={del} testId="delete-company-dialog"
            trigger={<button className="rounded border border-red px-4 py-2 text-sm text-red hover:bg-red-bg">{p.deleteBtn}</button>}>
            <p>{p.deleteA}<strong>{name}</strong>{t.delB(n(preview.total), files)}</p>
            <p className="text-mute">{t.delHidden}</p>
          </ConfirmDialog>
        </div>
      )}
    </section>
  );
}
