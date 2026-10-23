"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Grid } from "@/lib/ingest/extract";
import type { Cell } from "@/lib/ingest/parse";
import { preflightInWorker } from "@/lib/imports/worker-client";
import { toCsv, toXlsx, type Decisions, type IssueCode, type PreflightIssue, type PreflightModule, type PreflightReport, type PreflightRun, type SheetDecision, type SheetReport, type SheetStatus } from "@/lib/preflight";

export const STATUS_LABEL: Record<SheetStatus, string> = { ready: "Ready", ready_after_fixes: "Ready after fixes", cannot_import: "Cannot import yet" };
const STATUS_TONE: Record<SheetStatus, string> = { ready: "bg-green-bg text-green-d", ready_after_fixes: "bg-amber/20 text-[#9a6b00]", cannot_import: "bg-red-bg text-red" };
const show = (c: Cell) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c));

export function StatusChip({ status }: { status: SheetStatus }) {
  const Icon = status === "ready" ? CheckCircle2 : status === "ready_after_fixes" ? Wrench : XCircle;
  return <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium", STATUS_TONE[status])} data-testid="preflight-status"><Icon className="h-3.5 w-3.5" />{STATUS_LABEL[status]}</span>;
}

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Whether an issue is waiting on the person (a decision not yet made, or a block), unless a later step handles it. */
const open = (i: PreflightIssue, handOn: IssueCode[] = []) => i.level === "block" || (i.level === "fix" && i.fix !== "auto" && !handOn.includes(i.code));
/** Every sheet that goes in passes every rule, apart from issues a later step fixes row by row. */
export function readyFor(r: PreflightReport, handOn: IssueCode[] = []): boolean {
  const inc = r.sheets.filter((s) => s.include);
  return inc.length > 0 && inc.every((s) => s.status !== "cannot_import" && s.issues.every((i) => i.level === "info" || i.fix === "auto" || handOn.includes(i.code)));
}
/** Row-level value problems the upload wizard lists and fixes itself, row by row, before anything is saved. */
export const WIZARD_HANDS_ON: IssueCode[] = ["missing_values", "invalid_numbers", "invalid_dates", "error_cells"];

/**
 * The preflight step of every upload: each sheet's status, every issue with its rows and columns, the safe fixes made
 * for the person, the decisions only they can make, a before/after preview and the cleaned file to download. Nothing is
 * imported here; the cleaned copy goes on only when every rule passes. A file with nothing to decide passes straight on.
 */
export function Preflight({ module, grids, moduleLabel, fileName, stockMapping, onReady, autoPass = true, stopOnLeftOut = true, handOn = [], allowNone = false }: {
  module: PreflightModule;
  grids: Grid[];
  moduleLabel: string;
  fileName?: string;
  stockMapping?: Record<string, string>;
  onReady: (r: { run: PreflightRun; decisions: Decisions }) => void;
  autoPass?: boolean;
  /** Stop for the person when a sheet with figures is left out (the payments uploader asks about those itself). */
  stopOnLeftOut?: boolean;
  /** Issues a later step lists and fixes row by row: shown here, but they do not hold the upload back. */
  handOn?: IssueCode[];
  /** When no sheet can be imported, go on anyway: the next step says why for each sheet. */
  allowNone?: boolean;
}) {
  const [decisions, setDecisions] = useState<Decisions>({});
  const [run, setRun] = useState<PreflightRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passed = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    const n = ++seq.current;
    preflightInWorker(grids, module, decisions, stockMapping)
      .then((r) => { if (n === seq.current) { setRun(r); setError(null); } })
      .catch((e: Error) => { if (n === seq.current) setError(e.message || "The file could not be checked."); });
  }, [grids, module, decisions, stockMapping]);

  // Nothing to decide and nothing blocking: the cleaned copy goes on at once (the summary still lists what was fixed).
  useEffect(() => {
    if (!run || passed.current || !autoPass || Object.keys(decisions).length) return;
    const none = run.report.sheets.every((s) => !s.include);
    // A hidden or copied sheet with figures is always asked about; other left-out sheets only when stopOnLeftOut.
    const waiting = run.report.sheets.some((s) => (s.include && s.issues.some((i) => open(i, handOn)))
      || (!s.include && s.figures >= 3 && ((s.hidden || s.copyOf) ? decisions[s.sheet]?.include === undefined : stopOnLeftOut)));
    if (!waiting && (readyFor(run.final, handOn) || (allowNone && none))) { passed.current = true; onReady({ run, decisions }); }
  }, [run, autoPass, decisions, onReady, stopOnLeftOut, handOn, allowNone]);
  const canGo = run ? readyFor(run.final, handOn) || (allowNone && run.report.sheets.every((s) => !s.include)) : false;

  const set = (sheet: string, patch: Partial<SheetDecision>) => setDecisions((d) => ({ ...d, [sheet]: { ...d[sheet], ...patch } }));
  const base = (fileName ?? "upload").replace(/\.[^.]+$/, "");

  if (error) return <p className="rounded border border-red/40 bg-red-bg p-3 text-sm text-red" role="alert" data-testid="preflight-error">{error}</p>;
  if (!run) return <p className="text-sm text-mute" data-testid="preflight-busy">Checking the file…</p>;
  const included = run.report.sheets.filter((s) => s.include);
  const finalOf = (name: string) => run.final.sheets.find((s) => s.sheet === name);

  return (
    <div className="space-y-4" data-testid="preflight" data-ready={canGo}>
      <div className="rounded border border-line bg-panel p-3 text-[13.5px]">
        <p className="font-medium">Checked for {moduleLabel}: {run.report.sheets.length} sheet{run.report.sheets.length === 1 ? "" : "s"}, {included.length} to import.</p>
        <p className="text-mute">Nothing is imported until you confirm. Your file is not changed; the fixes go into a cleaned copy you can download.</p>
      </div>
      {run.report.sheets.map((s) => (
        <SheetCard key={s.sheet} s={s} handOn={handOn} after={finalOf(s.sheet)} d={decisions[s.sheet] ?? {}} set={(p) => set(s.sheet, p)}
          original={grids.find((g) => g.name === s.sheet)} cleaned={run.cleaned.grids.find((g) => g.name === s.sheet)} />
      ))}
      {run.cleaned.rejected.length > 0 && (
        <details className="rounded border border-line p-3 text-[13px]" data-testid="preflight-rejected">
          <summary className="cursor-pointer">{run.cleaned.rejected.length} row{run.cleaned.rejected.length === 1 ? "" : "s"} will not be imported (rejected)</summary>
          <ul className="mt-2 max-h-48 overflow-auto">{run.cleaned.rejected.slice(0, 300).map((r, i) => <li key={i}>{r.sheet} · row {r.row}: {r.reason}</li>)}</ul>
          <button className="mt-2 text-xs underline" onClick={() => download(`${base}-rejected.csv`, toCsv({ name: "rejected", rows: [["Sheet", "Row", "Reason"], ...run.cleaned.rejected.map((r) => [r.sheet, r.row, r.reason])] }), "text/csv")}>Download the rejected rows (.csv)</button>
        </details>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button className="inline-flex items-center gap-1 rounded border border-line px-3 py-1.5 text-sm hover:bg-band disabled:opacity-50" disabled={!run.cleaned.grids.length} data-testid="preflight-download-xlsx"
          onClick={async () => download(`${base}-cleaned.xlsx`, (await toXlsx(run.cleaned.grids)) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}><Download className="h-4 w-4" />Cleaned file (.xlsx)</button>
        {run.cleaned.grids.map((g) => (
          <button key={g.name} className="inline-flex items-center gap-1 rounded border border-line px-3 py-1.5 text-sm hover:bg-band" data-testid="preflight-download-csv"
            onClick={() => download(`${base}-${g.name.replace(/[^\w؀-ۿ-]+/g, "_")}-cleaned.csv`, "﻿" + toCsv(g), "text/csv")}><Download className="h-4 w-4" />{g.name} (.csv)</button>
        ))}
        <span className="flex-1" />
        <button className="rounded bg-brand-d px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!canGo} data-testid="preflight-continue" onClick={() => onReady({ run, decisions })}>
          {canGo ? "Continue with the cleaned file" : "Resolve the items above to continue"}
        </button>
      </div>
    </div>
  );
}

function SheetCard({ s, after, d, set, original, cleaned, handOn }: { s: SheetReport; after?: SheetReport; d: SheetDecision; set: (p: Partial<SheetDecision>) => void; original?: Grid; cleaned?: Grid; handOn: IssueCode[] }) {
  const [preview, setPreview] = useState(false);
  const relevant = !s.issues.some((i) => i.code === "empty" || i.code === "irrelevant");
  const auto = s.issues.filter((i) => i.fix === "auto" && i.level !== "info");
  const decide = s.issues.filter((i) => i.fix === "decision");
  const source = s.issues.filter((i) => i.fix === "source" && i.level !== "info");
  const notes = s.issues.filter((i) => i.level === "info" && i.fix !== "decision");
  const status = s.status;
  const passes = (d.include ?? s.include) && after !== undefined && readyFor({ module: "sales", sheets: [{ ...after, include: true }], ready: false }, handOn);
  return (
    <section className="rounded-md border border-line p-3 sm:p-4" data-testid="preflight-sheet" data-sheet={s.sheet} data-status={status} data-final={after?.status ?? ""}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 truncate font-medium">{s.sheet}</h3>
        <StatusChip status={status} />
        {passes && status !== "ready" && <span className="text-xs text-green-d" data-testid="preflight-passes">Cleaned copy passes every rule</span>}
        <span className="text-xs text-mute">{s.roleLabel}{s.dataRows ? ` · ${s.dataRows.toLocaleString("en-US")} rows` : ""}{s.headerRowNo > 1 ? ` · headings on row ${s.headerRowNo}` : ""}</span>
        <span className="flex-1" />
        {relevant && <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={d.include ?? s.include} onChange={(e) => set({ include: e.target.checked })} data-testid="preflight-include" />Import this sheet</label>}
      </div>
      {(d.include ?? s.include) && relevant && (
        <div className="mt-3 space-y-3 text-[13px]">
          {decide.length > 0 && <Group title="Your decisions" tone="warn" items={decide} render={(i) => <><Decision i={i} s={s} d={d} set={set} />{handOn.includes(i.code) && i.level === "fix" && <p className="text-xs text-mute">Or fix these rows one by one in the next step; nothing is saved until they are.</p>}</>} />}
          {source.length > 0 && <Group title="Fix in Odoo or in the file" tone="bad" items={source} />}
          {auto.length > 0 && <Group title="Fixed for you (safe, in the cleaned copy)" tone="ok" items={auto} />}
          {notes.length > 0 && <details><summary className="cursor-pointer text-mute">{notes.length} note{notes.length === 1 ? "" : "s"}</summary><ul className="mt-1 space-y-1">{notes.map((i, k) => <IssueLine key={k} i={i} />)}</ul></details>}
          {s.columns.length > 0 && <ColumnMap s={s} d={d} set={set} />}
          {original && <button className="text-xs underline" onClick={() => setPreview((p) => !p)} data-testid="preflight-preview">{preview ? "Hide" : "Show"} before and after</button>}
          {preview && original && <BeforeAfter before={original.rows.slice(0, 20)} after={(cleaned?.rows ?? []).slice(0, 20)} />}
        </div>
      )}
      {!relevant && <ul className="mt-2 space-y-1 text-[13px]">{s.issues.map((i, k) => <IssueLine key={k} i={i} />)}</ul>}
    </section>
  );
}

function Group({ title, tone, items, render }: { title: string; tone: "ok" | "warn" | "bad"; items: PreflightIssue[]; render?: (i: PreflightIssue) => React.ReactNode }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "warn" ? AlertTriangle : XCircle;
  return (
    <div>
      <p className={cn("mb-1 flex items-center gap-1 font-medium", tone === "ok" ? "text-green-d" : tone === "warn" ? "text-[#9a6b00]" : "text-red")}><Icon className="h-4 w-4" />{title}</p>
      <ul className="space-y-2">{items.map((i, k) => <li key={k} data-testid="preflight-issue" data-code={i.code}><IssueLine i={i} bare />{render?.(i)}</li>)}</ul>
    </div>
  );
}

function IssueLine({ i, bare }: { i: PreflightIssue; bare?: boolean }) {
  const body = (
    <>
      <span>{i.message}</span>
      {i.cols?.length ? <span className="text-mute"> Column{i.cols.length > 1 ? "s" : ""} {i.cols.join(", ")}.</span> : null}
      {i.needs && <span className="block text-mute">Needed: {i.needs}</span>}
      <span className="block text-mute">{i.action}</span>
    </>
  );
  return bare ? <div>{body}</div> : <li data-testid="preflight-issue" data-code={i.code}>{body}</li>;
}

function Decision({ i, s, d, set }: { i: PreflightIssue; s: SheetReport; d: SheetDecision; set: (p: Partial<SheetDecision>) => void }) {
  const sel = "rounded border border-line px-2 py-1 text-[13px]";
  switch (i.code) {
    case "duplicates":
      return (
        <div className="mt-1 flex flex-wrap gap-3">
          {(["keep_first", "keep_all"] as const).map((v) => <label key={v} className="flex items-center gap-1"><input type="radio" name={`dups-${s.sheet}`} checked={d.duplicates === v} onChange={() => set({ duplicates: v })} data-testid={`preflight-dups-${v}`} />{v === "keep_first" ? "Keep one of each" : "Keep all (real separate lines)"}</label>)}
        </div>
      );
    case "missing_values":
      return <label className="mt-1 flex items-center gap-1"><input type="checkbox" checked={Boolean(d.dropMissing)} onChange={(e) => set({ dropMissing: e.target.checked })} data-testid="preflight-drop-missing" />Import the other rows only; list these as rejected</label>;
    case "invalid_numbers": case "invalid_dates": case "error_cells":
      return <label className="mt-1 flex items-center gap-1"><input type="checkbox" checked={Boolean(d.dropInvalid)} onChange={(e) => set({ dropInvalid: e.target.checked })} data-testid="preflight-drop-invalid" />Leave out rows with unreadable values; list them as rejected</label>;
    case "date_order":
      return (
        <select className={cn(sel, "mt-1")} value={d.dateOrder ?? ""} onChange={(e) => set({ dateOrder: (e.target.value || undefined) as SheetDecision["dateOrder"] })} data-testid="preflight-date-order">
          <option value="">How are the dates written?</option><option value="dmy">Day first (31/01/2026)</option><option value="mdy">Month first (01/31/2026)</option>
        </select>
      );
    case "currencies": {
      const vals = i.action.match(/\(([^)]+)\)/)?.[1]?.split(" or ") ?? i.message.match(/\(([^)]+)\)/)?.[1]?.split(", ") ?? [];
      return (
        <select className={cn(sel, "mt-1")} value={d.currency ?? ""} onChange={(e) => set({ currency: e.target.value || undefined })} data-testid="preflight-currency">
          <option value="">Keep rows in…</option>{vals.map((v) => <option key={v} value={v}>{v} only</option>)}
        </select>
      );
    }
    case "total_mismatch":
      return (
        <div className="mt-1 flex flex-wrap gap-3">
          <label className="flex items-center gap-1"><input type="radio" name={`tot-${s.sheet}`} checked={d.dropOddTotals === true} onChange={() => set({ dropOddTotals: true })} data-testid="preflight-odd-totals-drop" />Leave them out (totals)</label>
          <label className="flex items-center gap-1"><input type="radio" name={`tot-${s.sheet}`} checked={d.dropOddTotals === false} onChange={() => set({ dropOddTotals: false })} />Keep them (real lines)</label>
        </div>
      );
    case "no_header":
      return (
        <select className={cn(sel, "mt-1")} value={d.headerRow ?? ""} onChange={(e) => set({ headerRow: e.target.value === "" ? undefined : Number(e.target.value), map: undefined })} data-testid="preflight-header-row">
          <option value="">Which row holds the headings?</option>
          {Array.from({ length: 30 }, (_, k) => k).map((k) => <option key={k} value={k}>Row {k + 1}</option>)}
        </select>
      );
    case "hidden_sheet": case "duplicate_sheet":
      return <label className="mt-1 flex items-center gap-1"><input type="checkbox" checked={d.include ?? false} onChange={(e) => set({ include: e.target.checked })} data-testid="preflight-include-anyway" />Include this sheet</label>;
    default:
      return null; // missing / ambiguous columns: the column list below
  }
}

/** Which column holds each field the import reads. A choice here is the person's; nothing is matched by guesswork. */
function ColumnMap({ s, d, set }: { s: SheetReport; d: SheetDecision; set: (p: Partial<SheetDecision>) => void }) {
  const [openMap, setOpen] = useState(s.issues.some((i) => i.code === "missing_column" || i.code === "ambiguous_column"));
  const current = useMemo(() => new Map(s.columns.filter((c) => c.field).map((c) => [c.field!, c.index])), [s.columns]);
  return (
    <div>
      <button className="text-xs underline" onClick={() => setOpen((o) => !o)} data-testid="preflight-columns-toggle">{openMap ? "Hide" : "Show"} columns ({s.columns.filter((c) => c.field).length} of {s.fields.length} fields found)</button>
      {openMap && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="preflight-columns">
          {s.fields.map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-2">
              <span>{f.label}{f.required && <span className="text-red"> *</span>}</span>
              <select className="max-w-[60%] rounded border border-line px-2 py-1 text-[13px]" value={d.map && f.key in d.map ? String(d.map[f.key] ?? "") : String(current.get(f.key) ?? "")} data-testid={`preflight-map-${f.key}`}
                onChange={(e) => set({ map: { ...d.map, [f.key]: e.target.value === "" ? null : Number(e.target.value) } })}>
                <option value="">— not in this file —</option>
                {s.columns.map((c) => <option key={c.index} value={c.index}>{c.letter}: {c.heading || "(no heading)"}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function BeforeAfter({ before, after }: { before: Cell[][]; after: Cell[][] }) {
  const table = (rows: Cell[][], title: string) => (
    <div className="min-w-0 flex-1">
      <p className="label mb-1">{title}</p>
      <div className="overflow-x-auto rounded border border-line">
        <table className="text-[12px]"><tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line first:border-0">{(r ?? []).slice(0, 12).map((c, j) => <td key={j} className="max-w-40 truncate whitespace-nowrap px-1.5 py-0.5">{show(c)}</td>)}</tr>)}</tbody></table>
      </div>
    </div>
  );
  return <div className="flex flex-col gap-3 lg:flex-row" data-testid="preflight-before-after">{table(before, "Your file")}{table(after, "Cleaned copy")}</div>;
}

/**
 * Preflight shown as an assessment only (the stock import keeps the original file, whose Odoo date-times decide each
 * record's day): every sheet's status and issues, and the cleaned copy to download. Import waits until no sheet that
 * goes in is "Cannot import yet".
 */
export function PreflightReportView({ run, fileName }: { run: PreflightRun; fileName: string }) {
  const base = fileName.replace(/\.[^.]+$/, "");
  return (
    <div className="space-y-2 rounded-md border border-line p-3 text-[13px]" data-testid="preflight-view" data-file={fileName}>
      {run.report.sheets.map((s) => (
        <div key={s.sheet} data-testid="preflight-sheet" data-sheet={s.sheet} data-status={s.status}>
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{fileName}{run.report.sheets.length > 1 ? ` › ${s.sheet}` : ""}</span><StatusChip status={s.status} />{s.dataRows > 0 && <span className="text-xs text-mute">{s.dataRows.toLocaleString("en-US")} rows checked</span>}</div>
          {s.issues.filter((i) => i.level !== "info").length > 0 && <ul className="mt-1 space-y-1">{s.issues.filter((i) => i.level !== "info").map((i, k) => <IssueLine key={k} i={i} />)}</ul>}
        </div>
      ))}
      {run.cleaned.grids.length > 0 && (
        <button className="inline-flex items-center gap-1 text-xs underline" data-testid="preflight-download-xlsx"
          onClick={async () => download(`${base}-cleaned.xlsx`, (await toXlsx(run.cleaned.grids)) as BlobPart, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}><Download className="h-3.5 w-3.5" />Download a cleaned copy (.xlsx)</button>
      )}
    </div>
  );
}
