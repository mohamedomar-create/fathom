"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clearData, deleteCompanyFully } from "@/app/company/[id]/settings/reset-actions";
import { confirmCount, type ResetModuleView, type ResetPreview, type ResetScope } from "@/lib/company/reset";

const n = (x: number) => x.toLocaleString("en-US");
const day = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : "");

function WhatGoes({ m }: { m: ResetModuleView }) {
  return (
    <>
      <ul className="list-disc ps-5" data-testid={`reset-tables-${m.key}`}>{m.tables.map((t) => <li key={t.key}><span className="num">{n(t.n)}</span> {t.label}</li>)}</ul>
      {m.uploads.length > 0 && (
        <div>
          <p className="label mt-2">From these uploads</p>
          <ul className="max-h-32 overflow-auto text-[13px] text-mute">{m.uploads.slice(0, 12).map((u, i) => <li key={i} className="truncate">{u.name} {day(u.at) && <span>· {day(u.at)}</span>}</li>)}{m.uploads.length > 12 && <li>and {m.uploads.length - 12} more</li>}</ul>
        </div>
      )}
      <p className="text-mute">{m.keeps}</p>
    </>
  );
}

/**
 * Clear one module's imported data, clear all of it (the company and its settings stay), or delete the company. Each
 * shows exactly what will be removed before it runs; the database removes nothing if the counts changed meanwhile.
 */
export function DataAndDeletion({ companyId, name, role, preview }: { companyId: string; name: string; role: "admin" | "editor" | "viewer"; preview: ResetPreview }) {
  const router = useRouter();
  const [done, setDone] = useState<string | null>(null);
  const canClear = role !== "viewer";
  const isAdmin = role === "admin";
  const clear = (scope: ResetScope, label: string) => async () => {
    const r = await clearData(companyId, scope, confirmCount(preview, scope));
    if (!r.ok) return r.error;
    setDone(`${label} cleared: ${n(r.removed)} records removed.${r.filesLeft ? ` ${r.filesLeft} stored file(s) could not be removed; try again later.` : ""}`);
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
      <h3 className="font-medium text-red">Data and deletion</h3>
      <p className="mb-3 text-sm text-mute">Removing data is permanent. Each step shows what goes before it runs, and every step is recorded (who, when, what).</p>
      {done && (
        <p className="mb-3 rounded border border-line bg-panel p-2 text-[13.5px]" role="status">
          {done} The company is ready for a clean upload: <Link className="underline" href={`/company/${companyId}/data`}>Data ▸ Steps</Link>.
        </p>
      )}
      <ul className="divide-y divide-line text-sm" data-testid="reset-modules">
        {preview.modules.map((m) => (
          <li key={m.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div>{m.label}</div>
              <div className="text-xs text-mute">{m.records ? `${n(m.records)} records · ${m.uploads.length} upload${m.uploads.length === 1 ? "" : "s"}` : "Nothing loaded"}</div>
            </div>
            {canClear && m.records > 0 && (
              <ConfirmDialog title={`Clear ${m.label.toLowerCase()}?`} confirmLabel="Clear" onConfirm={clear(m.key, m.label)} testId={`clear-${m.key}-dialog`}
                trigger={<button className="rounded border border-red px-3 py-1 text-sm text-red hover:bg-red-bg">Clear</button>}>
                <p>This permanently removes from <strong>{name}</strong>:</p>
                <WhatGoes m={m} />
              </ConfirmDialog>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && preview.total > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <ConfirmDialog reauth title="Clear all imported data?" confirmLabel="Clear all data" typeToConfirm="CLEAR" onConfirm={clear("all", "All imported data")} testId="clear-all-dialog"
            trigger={<button className="rounded border border-red px-4 py-2 text-sm text-red hover:bg-red-bg">Clear all imported data</button>}>
            <p>This permanently removes <strong>{n(preview.total)}</strong> records from <strong>{name}</strong>{files ? ` and ${files} stored source file${files === 1 ? "" : "s"}` : ""}:</p>
            <ul className="list-disc ps-5">{preview.modules.filter((m) => m.records).map((m) => <li key={m.key}>{m.label}: {n(m.records)}</li>)}</ul>
            <p className="text-mute">The company, its members, settings, account classes and remembered export layouts stay, so you can upload again from the start.</p>
          </ConfirmDialog>
        </div>
      )}
      {isAdmin && (
        <div className="mt-4 border-t border-line pt-3">
          <ConfirmDialog reauth title="Delete this company?" confirmLabel="Delete company" typeToConfirm={name} typeLabel="Type the company name" onConfirm={del} testId="delete-company-dialog"
            trigger={<button className="rounded border border-red px-4 py-2 text-sm text-red hover:bg-red-bg">Delete this company</button>}>
            <p>This deletes <strong>{name}</strong>: {n(preview.total)} imported records{files ? `, ${files} stored source file${files === 1 ? "" : "s"}` : ""}, its history, commentary, reports and shared report links, and its Odoo connection.</p>
            <p className="text-mute">It is hidden at once and can be brought back for 14 days from Organisation, Recently deleted. After that it is removed for good. The original uploaded files are removed now. A record of the deletion (who, when, the counts) is kept.</p>
          </ConfirmDialog>
        </div>
      )}
    </section>
  );
}
