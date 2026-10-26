"use client";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readInWorker } from "@/lib/imports/worker-client";
import { cashHeadingKey, readCashBook, type CashField, type CashSheet, type CashSheetOptions } from "@/lib/cash/read";
import { cashAdvice, unreadRows, type Advice } from "@/lib/cash/advice";
import type { Grid } from "@/lib/ingest/extract";
import { useCash } from "@/lib/cash/context";
import type { CashUpload as Upload } from "@/lib/cash/load";
import { detectKind } from "@/lib/cash/kinds";
import { rememberColumns, uploadBegin, uploadFinish, uploadPart, uploadRemove } from "@/app/cash/[id]/actions";
import { PageHeader } from "@/components/shell/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useT } from "@/lib/i18n/use-t";

const FIELDS: CashField[] = ["date", "in", "out", "amount", "qty", "price", "type", "category", "party", "note", "paid", "paidOn", "balance"];
const PART = 2000;
const LEVEL_STYLE: Record<Advice["level"], string> = { fix: "border-red/40 bg-red-bg", check: "border-amber/40 bg-amber/10", info: "border-line bg-band" };
const STATUS_STYLE: Record<CashSheet["status"], string> = { ready: "bg-green-bg text-green-d", choices: "bg-amber/15", blocked: "bg-red-bg text-red" };
const cellText = (c: unknown) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));

/**
 * Upload the sheet the business already keeps: read it, show per sheet what was read, what to fix in the sheet and
 * what was done, let the person choose the heading row, columns and which way amounts go, then save.
 */
export function CashUpload({ uploads }: { uploads: Upload[] }) {
  const { company, entries } = useCash();
  const T = useT();
  const t = T.d.cash;
  const router = useRouter();
  const [names, setNames] = useState<string[]>([]);
  const [grids, setGrids] = useState<Grid[] | null>(null);
  const [map, setMap] = useState<Record<string, CashField | "">>(company.columns);
  const [opts, setOpts] = useState<Record<string, CashSheetOptions>>({});
  const [leftOut, setLeftOut] = useState<Record<string, boolean>>({});
  const [mode, setMode] = useState<"add" | "replace_months" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const book = useMemo(() => (grids ? readCashBook(grids, { map, sheets: opts }) : null), [grids, map, opts]);
  const kept = useMemo(() => (book ? book.sheets.filter((s) => !leftOut[s.sheet]) : []), [book, leftOut]);
  const keptEntries = useMemo(() => kept.flatMap((s) => s.entries), [kept]);
  const months = useMemo(() => [...new Set(keptEntries.map((e) => e.day.slice(0, 7)))].sort(), [keptEntries]);
  const directions = useMemo(() => [...new Set(keptEntries.map((e) => e.direction))].sort() as ("in" | "out")[], [keptEntries]);
  // Months already holding entries of the same kind as this file (a sales file never replaces expenses).
  const overlap = useMemo(() => {
    const held = new Set(entries.filter((e) => directions.includes(e.direction)).map((e) => e.day.slice(0, 7)));
    return months.filter((m) => held.has(m));
  }, [entries, months, directions]);
  const chosenMode = mode ?? "replace_months";
  const waiting = kept.filter((s) => s.status !== "ready");
  const setSheet = (sheet: string, o: CashSheetOptions) => setOpts({ ...opts, [sheet]: { ...opts[sheet], ...o } });

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null); setDone(null); setBusy(t.reading); setOpts({}); setLeftOut({}); setMode(null);
    try {
      const list = [...files];
      setNames(list.map((f) => f.name));
      setGrids(await readInWorker(await Promise.all(list.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })))));
    } catch (e) { setError((e as Error).message || "The file could not be read."); setGrids(null); }
    setBusy(null);
  };

  const save = async () => {
    // One save at a time: a second press never starts a second upload.
    if (!book || !keptEntries.length || waiting.length || saving.current) return;
    saving.current = true;
    setError(null); setBusy(t.saving(0, keptEntries.length));
    try {
      const list = keptEntries.map((e) => ({ day: e.day, direction: e.direction, amount: e.amount, category: e.category, party: e.party, note: e.note, paid: e.paid, paidOn: e.paidOn, kind: detectKind(e.direction, [e.category, e.note, e.party].join(" ")) }));
      const skipped = kept.reduce((n, s) => n + s.skipped.length, 0);
      const begin = await uploadBegin(company.id, names.join(" + ").slice(0, 300), months, overlap.length ? chosenMode : "add", skipped, directions);
      if (!begin.ok) return setError(begin.error);
      for (let i = 0; i < list.length; i += PART) {
        setBusy(t.saving(Math.min(i + PART, list.length), list.length));
        const r = await uploadPart(begin.upload, list.slice(i, i + PART));
        if (!r.ok) return setError(r.error);
      }
      const fin = await uploadFinish(company.id, begin.upload);
      if (!fin.ok) return setError(fin.error);
      // The column choices are remembered for the next upload of the same sheet.
      const choices: Record<string, CashField | ""> = {};
      for (const s of kept) for (const c of s.columns) if (c.heading) choices[cashHeadingKey(c.heading)] = c.field ?? "";
      void rememberColumns(company.id, choices);
      setDone(t.saved(fin.rows, fin.removed));
      setGrids(null); setNames([]);
      router.refresh();
    } finally { saving.current = false; setBusy(null); }
  };

  const download = async (s: CashSheet) => {
    const g = grids?.find((x) => x.name === s.source);
    if (!g) return;
    const XLSX = await import("@e965/xlsx");
    const rows = unreadRows(s, g.rows as unknown[][], g.origin);
    const width = Math.max(1, ...rows.map((r) => r.cells.length));
    const head = (g.rows[s.headerRow] ?? []).map(cellText);
    const aoa = [[t.unreadRow, t.unreadWhy, ...Array.from({ length: width }, (_, i) => head[i] ?? "")], ...rows.map((r) => [r.row, r.why, ...r.cells.map(cellText)])];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "To fix");
    XLSX.writeFile(wb, `${s.source.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60)} - rows to fix.xlsx`);
  };

  return (
    <div data-testid="cash-upload">
      <PageHeader title={t.uploadTitle} />
      <p className="mb-2 max-w-3xl text-mute">{t.uploadText}</p>
      <p className="mb-4 max-w-3xl text-sm text-mute">{t.easiest}</p>
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
          {book.sheets.map((s) => <SheetCard key={s.sheet} s={s} grid={grids!.find((x) => x.name === s.source)!} out={Boolean(leftOut[s.sheet])}
            onOut={(v) => setLeftOut({ ...leftOut, [s.sheet]: v })} onOpts={(o) => setSheet(s.sheet, o)} opts={opts[s.sheet] ?? {}}
            onMap={(heading, f) => setMap({ ...map, [cashHeadingKey(heading)]: f })} onDownload={() => void download(s)} />)}
          {book.sheets.length > 0 && <div className="rounded-md border border-line p-4">
            {overlap.length > 0 && <fieldset className="mb-4 text-sm" data-testid="cash-mode"><legend className="mb-1 font-medium">{t.modeTitle} ({overlap.map((m) => T.ml(m)).join(", ").slice(0, 200)})</legend>
              <label className="me-6"><input type="radio" className="me-2" checked={chosenMode === "replace_months"} onChange={() => setMode("replace_months")} data-testid="cash-mode-replace" />{t.modeReplace}</label>
              <label><input type="radio" className="me-2" checked={chosenMode === "add"} onChange={() => setMode("add")} data-testid="cash-mode-add" />{t.modeAdd}</label>
            </fieldset>}
            {waiting.length > 0 && <p className="mb-3 text-sm text-red" data-testid="cash-blocked">{t.blockedSave} ({waiting.map((s) => s.sheet).join(", ")})</p>}
            <button type="button" disabled={Boolean(busy) || !keptEntries.length || waiting.length > 0} onClick={() => void save()} className="rounded bg-brand-d px-6 py-2.5 font-medium text-white disabled:opacity-50" data-testid="cash-save">{t.save} · {t.read(keptEntries.length)}</button>
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

function SheetCard({ s, grid, out, opts, onOut, onOpts, onMap, onDownload }: {
  s: CashSheet; grid: Grid; out: boolean; opts: CashSheetOptions;
  onOut: (v: boolean) => void; onOpts: (o: CashSheetOptions) => void; onMap: (heading: string, f: CashField | "") => void; onDownload: () => void;
}) {
  const T = useT();
  const t = T.d.cash;
  const advice = cashAdvice(s);
  const block = s.sheet !== s.source;
  const unread = s.skipped.filter((k) => k.code !== "total").length;
  const rowChoices = (grid.rows ?? []).slice(0, 30).map((r, i) => ({ i, label: (r ?? []).map(cellText).filter(Boolean).slice(0, 4).join(" | ").slice(0, 60) })).filter((x) => x.label);
  const kindChoice = s.layout === "amount" || s.layout === "signed" || s.needsKind;
  return (
    <section className={`rounded-md border border-line p-4 ${out ? "opacity-60" : ""}`} data-testid="cash-sheet" data-sheet={s.sheet}>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h3 className="text-lg font-normal">{t.sheet}: {s.sheet}</h3>
        <span className={`rounded px-2 py-0.5 text-xs ${out ? "bg-band" : STATUS_STYLE[s.status]}`} data-testid="cash-status" data-status={out ? "out" : s.status}>{out ? t.leftOut : t.status[s.status]}</span>
        <span className="text-sm text-mute">{t.layout[s.layout]}</span>
        <span className="text-sm" data-testid="cash-read-count">{t.read(s.entries.length)}</span>
        {s.skipped.length > 0 && <span className="text-sm text-red" data-testid="cash-skip-count">{t.skipped(s.skipped.length)}</span>}
        <label className="ms-auto text-sm"><input type="checkbox" className="me-2" checked={out} onChange={(e) => onOut(e.target.checked)} data-testid="cash-leave-out" />{t.leaveOut}</label>
      </div>
      {!out && <>
        {advice.length > 0 && <div className="mb-4 space-y-2" data-testid="cash-advice">
          {(["fix", "check", "info"] as const).map((level) => {
            const items = advice.filter((a) => a.level === level);
            return items.length ? (
              <div key={level} className={`rounded border px-3 py-2 text-sm ${LEVEL_STYLE[level]}`} data-testid={`cash-advice-${level}`}>
                <p className="mb-1 font-medium">{t.groups[level]}</p>
                <ul className="ms-5 list-disc space-y-0.5">{items.map((a) => <li key={a.code} data-code={a.code}>{(t.advice[a.code] ?? (() => a.code))(a.args)}</li>)}</ul>
              </div>
            ) : null;
          })}
        </div>}
        <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
          {!block && rowChoices.length > 0 && <label>{t.headerRow}{" "}
            <select className="rounded border border-line px-2 py-1" value={s.headerRow} data-testid="cash-header-row"
              onChange={(e) => onOpts({ headerRow: Number(e.target.value) })}>
              {rowChoices.map((r) => <option key={r.i} value={r.i}>{(grid.origin?.r ?? 0) + r.i + 1}: {r.label}</option>)}
            </select></label>}
          {s.notes.some((n) => n.code === "debitCredit") && <label><input type="checkbox" className="me-2" checked={Boolean(opts.swap)} onChange={(e) => onOpts({ swap: e.target.checked })} data-testid="cash-swap" />{t.swap}</label>}
        </div>
        {kindChoice && <div className="mb-3 flex flex-wrap items-center gap-3 rounded bg-amber/10 px-3 py-2 text-sm" data-testid="cash-kind">
          {t.whichKind}
          {(["in", "out", "signed"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={s.kind === k} className={`rounded border px-3 py-1 ${s.kind === k ? "border-brand-d bg-white font-medium" : "border-line bg-white"}`}
              onClick={() => onOpts({ kind: k })} data-testid={`cash-kind-${k}`}>{k === "in" ? t.isIn : k === "out" ? t.isOut : t.isSigned}</button>
          ))}
        </div>}
        {s.layout === "monthly" && s.rowLabels && s.rowLabels.length > 0 && <div className="mb-3 flex flex-wrap gap-4 text-sm" data-testid="cash-monthly-rows">
          {s.rowLabels.map((r) => <label key={r.label}><input type="checkbox" className="me-1" checked={r.direction === "in"}
            onChange={(e) => onOpts({ flip: { ...opts.flip, [r.label]: e.target.checked ? "in" : "out" } })} />{r.label}: {t.flipRow}</label>)}
        </div>}
        {s.layout !== "monthly" && <div className="overflow-x-auto">
          <table className="text-sm"><thead><tr className="text-xs text-mute"><th className="pe-4 text-start font-normal">{t.column}</th><th className="text-start font-normal">{t.readAs}</th></tr></thead>
            <tbody>{s.columns.filter((c) => c.heading).map((c) => (
              <tr key={c.index}><td className="py-1 pe-4"><span className="text-mute">{c.letter}</span> {c.heading}</td><td className="py-1">
                <select className="rounded border border-line px-2 py-1" value={c.field ?? ""} data-testid={`cash-col-${c.index}`}
                  onChange={(e) => onMap(c.heading, e.target.value as CashField | "")}>
                  <option value="">{t.notUsed}</option>
                  {FIELDS.map((f) => <option key={f} value={f}>{t.fields[f]}</option>)}
                </select></td></tr>
            ))}</tbody></table>
        </div>}
        {s.skipped.length > 0 && <details className="mt-3 text-sm" data-testid="cash-skips"><summary className="cursor-pointer">{t.why}</summary>
          <ul className="ms-5 mt-1 list-disc">{s.skipped.slice(0, 100).map((k) => <li key={`${k.sheet}-${k.row}`}>{t.row} {k.row}{k.cell ? ` (${k.cell})` : ""}: {k.reason}</li>)}</ul></details>}
        {unread > 0 && <button type="button" className="mt-3 text-sm text-brand-d underline" onClick={onDownload} data-testid="cash-unread">{t.unread}</button>}
      </>}
    </section>
  );
}
