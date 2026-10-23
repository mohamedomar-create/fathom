"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { readInWorker } from "@/lib/imports/worker-client";
import { cashHeadingKey, readCashBook, type CashField } from "@/lib/cash/read";
import type { Grid } from "@/lib/ingest/extract";
import { useCash } from "@/lib/cash/context";
import type { CashUpload as Upload } from "@/lib/cash/load";
import { rememberColumns, uploadBegin, uploadFinish, uploadPart, uploadRemove } from "@/app/cash/[id]/actions";
import { PageHeader } from "@/components/shell/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useT } from "@/lib/i18n/use-t";

const FIELDS: CashField[] = ["date", "in", "out", "amount", "type", "category", "party", "note", "paid", "paidOn"];
const PART = 2000;

/** Upload a sheet: read it, show what was read and what was skipped, confirm the columns, save. */
export function CashUpload({ uploads }: { uploads: Upload[] }) {
  const { company, entries } = useCash();
  const T = useT();
  const t = T.d.cash;
  const router = useRouter();
  const [names, setNames] = useState<string[]>([]);
  const [grids, setGrids] = useState<Grid[] | null>(null);
  const [map, setMap] = useState<Record<string, CashField | "">>(company.columns);
  const [kinds, setKinds] = useState<Record<string, "in" | "out">>({});
  const [mode, setMode] = useState<"add" | "replace_months">("replace_months");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const book = useMemo(() => (grids ? readCashBook(grids, { map, kinds }) : null), [grids, map, kinds]);
  const held = useMemo(() => new Set(entries.map((e) => e.day.slice(0, 7))), [entries]);
  const overlap = book ? book.months.filter((m) => held.has(m)) : [];

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null); setDone(null); setBusy(t.reading);
    try {
      const list = [...files];
      setNames(list.map((f) => f.name));
      setGrids(await readInWorker(await Promise.all(list.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })))));
    } catch (e) { setError((e as Error).message || "The file could not be read."); setGrids(null); }
    setBusy(null);
  };

  const save = async () => {
    if (!book?.entries.length) return;
    setError(null);
    const list = book.entries.map((e) => ({ day: e.day, direction: e.direction, amount: e.amount, category: e.category, party: e.party, note: e.note, paid: e.paid, paidOn: e.paidOn }));
    const begin = await uploadBegin(company.id, names.join(" + ").slice(0, 300), book.months, overlap.length ? mode : "add", book.skipped.length);
    if (!begin.ok) return setError(begin.error);
    for (let i = 0; i < list.length; i += PART) {
      setBusy(t.saving(Math.min(i + PART, list.length), list.length));
      const r = await uploadPart(begin.upload, list.slice(i, i + PART));
      if (!r.ok) { setBusy(null); return setError(r.error); }
    }
    const fin = await uploadFinish(company.id, begin.upload);
    setBusy(null);
    if (!fin.ok) return setError(fin.error);
    // The column choices are remembered for the next upload of the same sheet.
    const choices: Record<string, CashField | ""> = {};
    for (const s of book.sheets) for (const c of s.columns) if (c.heading) choices[cashHeadingKey(c.heading)] = c.field ?? "";
    void rememberColumns(company.id, choices);
    setDone(t.saved(fin.rows, fin.removed));
    setGrids(null); setNames([]);
    router.refresh();
  };

  return (
    <div data-testid="cash-upload">
      <PageHeader title={t.uploadTitle} />
      <p className="mb-4 max-w-3xl text-mute">{t.uploadText}</p>
      {company.readOnly ? <p className="rounded bg-band px-4 py-2 text-sm">{t.viewOnly}</p> : <>
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <label className="cursor-pointer rounded bg-brand-d px-5 py-2.5 font-medium text-white">
            {t.choose}
            <input type="file" multiple accept=".xlsx,.xls,.csv,.txt" className="sr-only" data-testid="cash-file" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
          </label>
          <a href="/api/templates/cash-book" download className="text-sm text-brand-d underline" data-testid="cash-template">{t.template}</a>
          {names.length > 0 && <span className="text-sm text-mute">{names.join(", ")}</span>}
        </div>
        {busy && <p role="status" className="mb-4 text-sm" data-testid="cash-busy">{busy}</p>}
        {error && <p role="alert" className="mb-4 rounded bg-red-bg px-4 py-2 text-sm text-red" data-testid="cash-upload-error">{error}</p>}
        {done && <p role="status" className="mb-4 rounded bg-green-bg px-4 py-2 text-sm text-green-d" data-testid="cash-saved">{done} <Link prefetch={false} href={`/cash/${company.id}`} className="underline">{t.see}</Link></p>}
        {book && <div className="space-y-6">
          {!book.sheets.length && <p className="rounded bg-amber/10 px-4 py-2 text-sm" data-testid="cash-none">{t.noneRead}</p>}
          {book.ignored.length > 0 && <p className="text-sm text-mute">{t.notCash(book.ignored.join(", "))}</p>}
          {book.sheets.map((s) => (
            <section key={s.sheet} className="rounded-md border border-line p-4" data-testid="cash-sheet">
              <div className="mb-2 flex flex-wrap items-baseline gap-3">
                <h3 className="text-lg font-normal">{t.sheet}: {s.sheet}</h3>
                <span className="text-sm text-mute">{t.layout[s.layout]}</span>
                <span className="text-sm" data-testid="cash-read-count">{t.read(s.entries.length)}</span>
                {s.skipped.length > 0 && <span className="text-sm text-red" data-testid="cash-skip-count">{t.skipped(s.skipped.length)}</span>}
              </div>
              {s.needsKind && <div className="mb-3 flex flex-wrap items-center gap-3 rounded bg-amber/10 px-3 py-2 text-sm" data-testid="cash-kind">
                {t.whichKind}
                <button type="button" className="rounded border border-line bg-white px-3 py-1" onClick={() => setKinds({ ...kinds, [s.sheet]: "in" })} data-testid="cash-kind-in">{t.isIn}</button>
                <button type="button" className="rounded border border-line bg-white px-3 py-1" onClick={() => setKinds({ ...kinds, [s.sheet]: "out" })} data-testid="cash-kind-out">{t.isOut}</button>
              </div>}
              <div className="overflow-x-auto">
                <table className="text-sm"><thead><tr className="text-xs text-mute"><th className="pe-4 text-start font-normal">{t.column}</th><th className="text-start font-normal">{t.readAs}</th></tr></thead>
                  <tbody>{s.columns.filter((c) => c.heading).map((c) => (
                    <tr key={c.index}><td className="py-1 pe-4">{c.heading}</td><td className="py-1">
                      <select className="rounded border border-line px-2 py-1" value={c.field ?? ""} data-testid={`cash-col-${c.index}`}
                        onChange={(e) => setMap({ ...map, [cashHeadingKey(c.heading)]: e.target.value as CashField | "" })}>
                        <option value="">{t.notUsed}</option>
                        {FIELDS.map((f) => <option key={f} value={f}>{t.fields[f]}</option>)}
                      </select></td></tr>
                  ))}</tbody></table>
              </div>
              {s.skipped.length > 0 && <details className="mt-3 text-sm" data-testid="cash-skips"><summary className="cursor-pointer">{t.why}</summary>
                <ul className="ms-5 mt-1 list-disc">{s.skipped.slice(0, 100).map((k) => <li key={`${k.sheet}-${k.row}`}>{t.row} {k.row}: {k.reason}</li>)}</ul></details>}
            </section>
          ))}
          {book.entries.length > 0 && <div className="rounded-md border border-line p-4">
            {overlap.length > 0 && <fieldset className="mb-4 text-sm" data-testid="cash-mode"><legend className="mb-1 font-medium">{t.modeTitle} ({overlap.map((m) => T.ml(m)).join(", ").slice(0, 200)})</legend>
              <label className="me-6"><input type="radio" className="me-2" checked={mode === "replace_months"} onChange={() => setMode("replace_months")} data-testid="cash-mode-replace" />{t.modeReplace}</label>
              <label><input type="radio" className="me-2" checked={mode === "add"} onChange={() => setMode("add")} data-testid="cash-mode-add" />{t.modeAdd}</label>
            </fieldset>}
            <button type="button" disabled={Boolean(busy)} onClick={() => void save()} className="rounded bg-brand-d px-6 py-2.5 font-medium text-white disabled:opacity-50" data-testid="cash-save">{t.save} · {t.read(book.entries.length)}</button>
          </div>}
        </div>}
      </>}
      {uploads.length > 0 && <section className="mt-10">
        <h3 className="mb-2 text-lg font-normal">{t.history}</h3>
        <table className="w-full text-sm" data-testid="cash-history"><tbody>{uploads.map((u) => (
          <tr key={u.id} className="border-b border-line/60">
            <td className="py-1.5">{u.filename || "–"}</td><td className="py-1.5 text-mute">{u.created_at.slice(0, 10)}</td><td className="py-1.5">{t.read(u.rows)}</td>
            <td className="py-1.5 text-end">{!company.readOnly && <ConfirmDialog title={t.undoTitle} confirmLabel={t.undo} testId="cash-undo-dialog"
              trigger={<button type="button" className="text-red hover:underline" data-testid="cash-undo">{t.undo}</button>}
              onConfirm={async () => { const r = await uploadRemove(company.id, u.id); if (!r.ok) return r.error; router.refresh(); }}><p>{t.undoText(u.rows)}</p></ConfirmDialog>}</td>
          </tr>
        ))}</tbody></table>
      </section>}
    </div>
  );
}
