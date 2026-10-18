"use client";
import type { LocationTypes } from "@/lib/ingest/inventory";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { ODOO_TEMPLATES, type ExportKey, type Field, type SavedMapping } from "@/lib/ingest/odoo-templates";
import type { FileSample } from "@/lib/imports/prepare";
import { sampleInWorker } from "@/lib/imports/worker-client";
import { importError, pendingJob, savedTemplates, saveTemplate, startImport, type ImportMode, type ImportProgress } from "@/lib/imports/jobs";
import { saveInventorySettings } from "@/app/company/[id]/settings/actions";
import { WizardNav, WizardSteps, WizardTitle } from "@/components/upload/wizard-shell";
import { ImportJobs } from "./import-jobs";
import { cn } from "@/lib/cn";

/**
 * Odoo Inventory exports, imported as a background job: choose the files → a sample of each (which export it is, how its
 * columns map, the first rows as iReport reads them; any column can be pointed elsewhere and the choice is kept) → how to
 * save → the files are uploaded, read off the page's main thread and sent straight to the database, which checks and
 * saves them in the background. The job list shows where each import is, its counts and its problems.
 */
const MAX_FILES = 6, MAX_MB = 50;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const EXPORTS = Object.values(ODOO_TEMPLATES);

export function OdooImport({ companyId, rentalLocation: savedRental, timeZone = null, locationTypes, onBack }: { companyId: string; rentalLocation: string | null; timeZone?: string | null; locationTypes?: LocationTypes; onBack?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [samples, setSamples] = useState<FileSample[] | null>(null);
  const [saved, setSaved] = useState<Partial<Record<ExportKey, SavedMapping>>>({});
  const [changed, setChanged] = useState<Set<ExportKey>>(new Set());
  const [forced, setForced] = useState<Record<string, ExportKey | null>>({});
  const [screen, setScreen] = useState<"upload" | "check" | "save" | "running">("upload");
  const [mode, setMode] = useState<ImportMode | null>(null);
  const [rental, setRental] = useState<string | null>(savedRental);
  const [cutoff, setCutoff] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [resume, setResume] = useState<string | null>(null);
  const [jobsKey, setJobsKey] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { savedTemplates(companyId).then(setSaved, () => setSaved({})); }, [companyId]);

  async function sample(fs: File[], s: Partial<Record<ExportKey, SavedMapping>>, f: Record<string, ExportKey | null>) {
    setBusy(true); setErr(null);
    try { setSamples(await sampleInWorker(fs, s, f)); }
    catch (e) { setErr((e as Error).message || "The files could not be read."); setSamples(null); }
    finally { setBusy(false); }
  }
  async function onFiles(fs: File[]) {
    setErr(null);
    if (!fs.length) return;
    if (fs.length > MAX_FILES) { setErr(`Choose up to ${MAX_FILES} files at a time.`); return; }
    const big = fs.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (big) { setErr(`${big.name} is larger than ${MAX_MB} MB. Export a shorter date range.`); return; }
    if (fs.some((f) => !/\.(xlsx|xls|csv)$/i.test(f.name))) { setErr("Choose Excel (.xlsx) or CSV files exported from Odoo."); return; }
    setFiles(fs); setForced({}); setChanged(new Set());
    await sample(fs, saved, {});
    setScreen("check");
  }
  const setColumn = async (key: ExportKey, field: Field, heading: string) => {
    const m = { ...(saved[key] ?? {}), [field]: heading } as SavedMapping;
    const s = { ...saved, [key]: m };
    setSaved(s); setChanged((c) => new Set(c).add(key));
    await sample(files, s, forced);
  };
  const setExport = async (name: string, key: ExportKey | null) => {
    const f = { ...forced, [name]: key };
    setForced(f);
    await sample(files, saved, f);
  };

  const ready = samples?.filter((s) => s.export && !s.columns?.missing.length) ?? [];
  const blocked = samples?.filter((s) => !s.export || s.columns?.missing.length) ?? [];
  const exportsUsed = new Set(ready.map((s) => s.export));
  const repeated = ready.length !== exportsUsed.size;
  const stockFiles = ready.filter((s) => s.export === "stock.valuation.layer" || s.export === "stock.move.line");
  const withIds = stockFiles.length > 0 && stockFiles.every((s) => s.columns?.fields.find((f) => f.field === "id")?.col !== null);
  const withUpdated = stockFiles.every((s) => s.columns?.fields.find((f) => f.field === "updated")?.col !== null);
  const hasMoves = exportsUsed.has("stock.move.line");
  const locations = [...new Set((samples ?? []).filter((s) => s.export === "stock.move.line").flatMap((s) => s.preview.flatMap((r) => [r.From, r.To])).filter((l) => l && !/vendor|customer|partner/i.test(l)))].sort();

  async function run() {
    if (!mode || !samples) return;
    setScreen("running"); setErr(null); setProgress(null);
    try {
      for (const k of changed) if (saved[k]) await saveTemplate(companyId, k, saved[k]!).catch(() => undefined);
      if (hasMoves && rental !== savedRental) await saveInventorySettings(companyId, { rentalLocation: rental }).catch(() => undefined);
      const list = ready.map((s) => ({ file: files.find((f) => f.name === s.name)!, export: s.export!, mapping: saved[s.export!] }));
      await startImport(companyId, mode, list, { rentalLocation: rental, asOf: today(), timeZone, ...(cutoff ? { cutoff } : {}), ...(locationTypes && Object.keys(locationTypes).length ? { locationTypes } : {}) }, setProgress, resume ?? undefined)
        // Odoo's own location types, when the moves export carries them, are kept for the Inventory pages.
        .then(async ({ parsed }) => { if (parsed.locationTypes) await saveInventorySettings(companyId, { rentalLocation: rental, locationTypes: parsed.locationTypes, from: "export" }).catch(() => undefined); });
      setJobsKey((k) => k + 1);
    } catch (e) {
      setErr(importError(e)); setJobsKey((k) => k + 1);
    }
  }
  const continueJob = (job: string) => {
    const p = pendingJob(job);
    setResume(job);
    setErr(p ? `Choose the same files to continue: ${p.files.map((f) => f.name).join(", ")}.` : null);
    setScreen("upload");
  };

  if (screen === "running") {
    const done = progress?.phase === "queued";
    return (
      <div data-testid="import-running">
        <WizardSteps at="save" />
        <WizardTitle title={done ? "Your import is on its way" : "Importing your stock"} hint={done ? "iReport is checking and saving it in the background. You can leave this page." : progress?.phase === "server" ? "The files are uploaded. iReport is sending the rows: you can close this page." : "Keep this page open until the files are uploaded."} />
        {!done && !err && (
          <div className="mb-6 max-w-2xl space-y-3" data-testid="import-progress">
            <Bar label="Uploading the original files" value={progress?.upload ?? 0} testId="progress-upload" />
            <Bar label="Reading the files" value={progress?.read ?? 0} testId="progress-read" />
            <Bar label="Sending the rows" value={progress?.send ?? 0} testId="progress-send" />
          </div>
        )}
        {err && <p className="mb-4 max-w-2xl rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert" data-testid="import-error">{err}</p>}
        <ImportJobs companyId={companyId} refreshKey={jobsKey} onContinue={continueJob} />
        <WizardNav onBack={() => { setScreen("upload"); setSamples(null); setFiles([]); setMode(null); setResume(null); setProgress(null); }} back="Import more files" />
      </div>
    );
  }

  if (screen === "save" && samples) {
    const options: [ImportMode, string, string, boolean][] = [
      ["all", "Replace all my stock records", "For a full export from Odoo (all dates). Everything saved before for valuation and moves is replaced by these files.", true],
      ["replace", "Replace these months", "Valuation and moves from the files' first month to their last are replaced. Other months stay.", true],
      ["add", "Add only new records", "Records already saved are kept and counted. Nothing is removed.", true],
      ["update", "Add new and changed records", withIds ? (withUpdated ? "Matched by Odoo ID: new records are added, records changed in Odoo (later “Last updated on”) replace the saved copy." : "Matched by Odoo ID: new records are added, records that differ replace the saved copy. Add the “Last updated on” column to compare dates.") : "Needs Odoo’s ID column: export with “I want to update data (import-compatible export)” ticked.", withIds],
    ];
    return (
      <div data-testid="import-save">
        <WizardSteps at="save" />
        <WizardTitle title="How should iReport save it?" hint={`${ready.length} file${ready.length === 1 ? "" : "s"}, about ${ready.reduce((s, x) => s + x.totalRows, 0).toLocaleString("en-US")} rows.`} />
        <div className="grid max-w-5xl gap-3 md:grid-cols-2" data-testid="import-mode">
          {options.map(([m, t, sub, ok]) => (
            <button key={m} disabled={!ok} onClick={() => setMode(m)} data-testid={`import-mode-${m}`}
              className={cn("rounded-xl border-2 p-4 text-start disabled:opacity-50", mode === m ? "border-brand-d bg-brand-bg" : "border-line hover:border-brand/60")}>
              <div className="text-[16px] font-medium">{t}</div><div className="mt-1 text-[13px] text-mute">{sub}</div>
            </button>
          ))}
        </div>
        {stockFiles.length > 0 && !withIds && <p className="mt-4 flex max-w-5xl gap-2 rounded bg-amber/10 px-3 py-2 text-[13px]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber" />These exports have no Odoo ID column, so records are matched by date, document, product, lot and amounts. For exact matching, export again: tick “I want to update data (import-compatible export)” and add the ID field (the database ID). Do not add External ID: Odoo would create new records to make those IDs.</p>}
        <p className="mt-4 max-w-5xl text-[13px] text-mute">Rows that cannot be read stop the import before anything is saved; you then see each one with its row number and choose.</p>
        <WizardNav onBack={() => setScreen("check")} next="Import" nextTestId="import-start" disabled={!mode} hint={!mode ? "Choose one first." : undefined} onNext={run} />
      </div>
    );
  }

  if (screen === "check" && samples) {
    return (
      <div data-testid="import-check">
        <WizardSteps at="check" />
        <WizardTitle title="Check your files" hint="A sample of each file, read the way iReport will read all of it. Change a column if it is wrong." />
        {err && <p className="mb-4 max-w-5xl rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        <div className="space-y-5">{samples.map((s) => <SampleCard key={s.name} s={s} busy={busy} onColumn={setColumn} onExport={setExport} />)}</div>
        {hasMoves && (
          <label className="mt-5 flex max-w-5xl flex-wrap items-center gap-2 text-[14px]" data-testid="rental-location">
            Rented items go to:
            <select value={rental ?? ""} onChange={(e) => setRental(e.target.value || null)} className="rounded border border-line px-2 py-1 text-[13px]" data-testid="rental-location-select">
              <option value="">Found by Odoo’s rental location (“Virtual Locations/Rental”)</option>
              {[...new Set([...(rental ? [rental] : []), ...locations])].map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        )}
        {stockFiles.length > 0 && (
          <label className="mt-5 flex max-w-5xl flex-wrap items-center gap-2 text-[14px]" data-testid="stock-cutoff">
            Cut-off date
            <input type="date" value={cutoff} onChange={(e) => setCutoff(/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : "")} className="rounded border border-line px-2 py-1 text-[13px]" />
            <span className="text-mute">Optional. Layers and moves dated after it are left out. Stock on hand is the count on the day it was exported.</span>
          </label>
        )}
        {repeated && <p className="mt-4 max-w-5xl rounded bg-red-bg px-3 py-2 text-sm text-red">Two files are the same kind of export. Import one of each at a time.</p>}
        <WizardNav onBack={() => { setScreen("upload"); setSamples(null); }} next="Next: how to save" nextTestId="import-next" disabled={busy || !ready.length || repeated || blocked.length > 0}
          hint={blocked.length ? `Fix or remove: ${blocked.map((b) => b.name).join(", ")}.` : undefined} onNext={() => { setMode(null); setScreen("save"); }} />
      </div>
    );
  }

  return (
    <div data-testid="import-upload">
      <WizardSteps at="upload" />
      <WizardTitle title="Upload your stock files" hint="Odoo’s Valuation, Moves History and Product Variants exports: one, or all of them together." />
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFiles(Array.from(e.dataTransfer.files)); }} onClick={() => input.current?.click()}
        className="flex max-w-4xl cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand/50 bg-brand-bg/10 px-6 py-16 text-center transition hover:border-brand hover:bg-brand-bg/30" data-testid="dropzone">
        {busy ? <Loader2 className="h-12 w-12 animate-spin text-brand" /> : <Upload className="h-12 w-12 text-brand" strokeWidth={1.5} />}
        <div className="mt-4 text-xl">{busy ? "Reading a sample…" : "Drop your files here, or click to choose"}</div>
        <div className="mt-1 text-[14px] text-mute">Excel or CSV, up to {MAX_MB} MB each. Large files are fine: they are read in the background.</div>
        <input ref={input} type="file" multiple accept=".xlsx,.xls,.csv" className="hidden" data-testid="file-input" onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        {err && <p className="mt-5 max-w-xl rounded bg-red-bg px-3 py-2 text-start text-sm text-red" role="alert" data-testid="upload-error" onClick={(e) => e.stopPropagation()}>{err}</p>}
      </div>
      <div className="mt-6"><ImportJobs companyId={companyId} refreshKey={jobsKey} onContinue={continueJob} limit={5} /></div>
      <WizardNav onBack={onBack} />
    </div>
  );
}

function Bar({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div data-testid={testId} data-value={Math.round(value * 100)}>
      <div className="mb-1 flex justify-between text-[13px]"><span>{label}</span><span className="num text-mute">{pct(value)}</span></div>
      <div className="h-2 overflow-hidden rounded bg-band"><div className="h-full bg-brand-d transition-all" style={{ width: pct(value) }} /></div>
    </div>
  );
}

function SampleCard({ s, busy, onColumn, onExport }: { s: FileSample; busy: boolean; onColumn: (k: ExportKey, f: Field, h: string) => void; onExport: (name: string, k: ExportKey | null) => void }) {
  const cols = s.preview.length ? Object.keys(s.preview[0]) : [];
  const missing = s.columns?.missing ?? [];
  return (
    <section className={cn("max-w-5xl rounded-xl border-2 p-4", !s.export || missing.length ? "border-red/50" : "border-line")} data-testid="import-sample">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FileSpreadsheet className="h-5 w-5 text-brand" />
        <span className="font-medium">{s.name}</span>
        <span className="text-[13px] text-mute">{mb(s.size)} · about {s.totalRows.toLocaleString("en-US")} rows</span>
        <select value={s.export ?? ""} disabled={busy} onChange={(e) => onExport(s.name, (e.target.value || null) as ExportKey | null)} className="ms-auto rounded border border-line px-2 py-1 text-[13px]" data-testid="import-export-select">
          <option value="">Not an Inventory export</option>
          {EXPORTS.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
        </select>
      </div>
      {!s.export && <p className="mt-2 text-[13px] text-red">{s.why}</p>}
      {s.export && s.pageSized && <p className="mt-2 text-[13px] text-amber" data-testid="page-sized">This file has exactly {s.totalRows.toLocaleString("en-US")} records: one page of Odoo’s list. In Odoo, tick the top box, then click “Select all N records”, and export again.</p>}
      {s.export && s.columns && (
        <>
          <details className="mt-3" open={missing.length > 0}>
            <summary className="cursor-pointer text-[13px] text-mute">{missing.length ? <span className="text-red">Missing: {missing.join(", ")}. Choose the column for each.</span> : "Columns (all found)"}</summary>
            <div className="mt-2 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2" data-testid="import-columns">
              {s.columns.fields.map((f) => (
                <label key={f.field} className="flex items-center gap-2">
                  <span className={cn("w-36 shrink-0", f.required && f.col === null && "text-red")}>{f.label}{f.required ? " *" : ""}</span>
                  <select value={f.heading ?? ""} disabled={busy} onChange={(e) => onColumn(s.export!, f.field, e.target.value)} className="min-w-0 flex-1 rounded border border-line px-1.5 py-0.5" title={f.hint}>
                    <option value="">{f.required ? "— choose —" : "Not in this file"}</option>
                    {s.columns!.headings.filter(Boolean).map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </details>
          {s.columns.fields.find((f) => f.field === "id")?.col === null && (s.export === "stock.valuation.layer" || s.export === "stock.move.line") && <p className="mt-2 text-[12.5px] text-mute">No Odoo ID column: records are matched by their contents.</p>}
          {cols.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="tbl min-w-[640px] text-[12.5px]" data-testid="import-preview">
                <thead><tr>{cols.map((c) => <th key={c} className="!text-start">{c}</th>)}</tr></thead>
                <tbody>{s.preview.map((r, k) => <tr key={k}>{cols.map((c) => <td key={c} className="!text-start">{r[c]}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          {s.issues.length > 0 && <ul className="mt-2 list-disc ps-5 text-[12.5px] text-red">{s.issues.slice(0, 5).map((i) => <li key={i.line}>Row {i.line}: {i.message}</li>)}</ul>}
        </>
      )}
    </section>
  );
}
