"use client";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { mlabel, money, type ClassKey } from "@/lib/engine";
import { CLASS_LABEL, CLASS_OPTIONS, extractAll, runIngest, toAccountInputs, type IngestOptions, type IngestResult } from "@/lib/ingest/pipeline";
import type { RawLine } from "@/lib/ingest/extract";
import { normLabel } from "@/lib/ingest/parse";
import { readWorkbook } from "@/lib/ingest/read";
import { commitImport } from "@/app/company/[id]/settings/actions";
import { cn } from "@/lib/cn";

type Filter = "review" | "all" | "excluded";

export function UploadWizard({ companyId, currency, fyStart, savedMapping, hasData, demo = false }: { companyId: string; currency: string; fyStart: number; savedMapping: Record<string, string>; hasData: boolean; demo?: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [raw, setRaw] = useState<{ lines: RawLine[]; issues: { skippedCols: string[]; warnings: string[] } } | null>(null);
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [opts, setOpts] = useState<Omit<IngestOptions, "mapping">>({ fyStart, ytd: "auto", closeEarnings: "auto", plugEquity: false });
  const [mapping, setMapping] = useState<Record<string, ClassKey | "">>(savedMapping as Record<string, ClassKey | "">);
  const [filter, setFilter] = useState<Filter>("review");
  const [saving, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const onFile = useCallback(async (f: File) => {
    setErr(null); setBusy(true); setFile(f); setDiag(null);
    try {
      if (f.size > 25 * 1024 * 1024) throw new Error("That file is larger than 25 MB. Export a shorter date range or the monthly Trial Balance instead of journal items.");
      if (/\.pdf$/i.test(f.name)) throw new Error("PDF reports can't be read. In Odoo, open the report and use Export → XLSX instead of Print.");
      let grids: Awaited<ReturnType<typeof readWorkbook>>;
      try { grids = await readWorkbook(await f.arrayBuffer(), f.name); }
      catch { throw new Error("This file couldn't be opened as a spreadsheet. Save it as .xlsx or .csv and try again."); }
      const { raw: lines, issues } = extractAll(grids);
      setDiag(diagnostic(f, grids, issues));
      if (!lines.length) throw new Error(issues.warnings[0] ?? "No usable rows found. See the tips on the right for the export formats that work best.");
      setRaw({ lines, issues });
    } catch (e) {
      console.error("upload read failed", e);
      setErr((e as Error).message || "The file could not be read."); setRaw(null);
    } finally { setBusy(false); }
  }, []);

  const [res, ingestErr]: [IngestResult | null, string | null] = useMemo(() => {
    if (!raw) return [null, null];
    try { return [runIngest(raw.lines, raw.issues, { ...opts, mapping }), null]; }
    catch (e) { console.error("ingest failed", e); return [null, (e as Error).message || "The file could not be analysed."]; }
  }, [raw, opts, mapping]);

  const setCls = (labelKey: string, cls: ClassKey | "") => setMapping((m) => ({ ...m, [labelKey]: cls }));
  const lines = res?.lines.filter((l) => !l.system) ?? [];
  const review = lines.filter((l) => !l.cls || (l.conf < 0.7 && !l.excluded));
  const shown = filter === "review" ? review : filter === "excluded" ? lines.filter((l) => l.excluded) : lines;
  const lastP = res?.periods[res.periods.length - 1];
  const maxImb = res ? Math.max(0, ...Object.values(res.imbalance).map(Math.abs)) : 0;

  async function commit() {
    if (!res || !file) return;
    if (hasData && !confirm("This replaces the company's current financial data with this file. Continue?")) return;
    setErr(null);
    start(async () => {
      try {
        const accounts = toAccountInputs(res);
        if (!accounts.length) { setErr("Nothing to import: every line is excluded or has no amounts. Map at least one account."); return; }
        const out = await commitImport({
          companyId, filename: file.name, accounts,
          report: { kind: res.kind, periods: res.periods, warnings: res.issues.warnings, notes: res.issues.notes, flips: res.issues.flips, mapping: Object.fromEntries(Object.entries(mapping).filter(([k]) => !k.includes("|"))) },
        });
        if (!out.ok) { setErr(out.error); return; }
        router.push(`/company/${companyId}/summary`);
        router.refresh();
      } catch (e) {
        console.error("import failed", e);
        setErr(`The import could not be saved (${(e as Error).message || "network error"}). If the file is very large, export a shorter date range and try again.`);
      }
    });
  }

  if (!res) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
          onClick={() => input.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line px-6 py-16 text-center transition hover:border-green hover:bg-green-bg/20"
          data-testid="dropzone"
        >
          {busy ? <Loader2 className="h-10 w-10 animate-spin text-green" /> : <Upload className="h-10 w-10 text-green" strokeWidth={1.5} />}
          <div className="mt-3 text-lg">{busy ? `Reading ${file?.name}…` : "Drop an Odoo export here, or click to choose"}</div>
          <div className="mt-1 text-sm text-mute">.xlsx, .xls or .csv · English or Arabic · read in your browser</div>
          <input ref={input} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" data-testid="file-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
          {(err || ingestErr) && <p className="mt-4 max-w-md rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err || ingestErr}</p>}
          {(err || ingestErr) && diag && <button type="button" onClick={(e) => { e.stopPropagation(); downloadDiagnostic(diag); }} className="mt-2 text-xs text-mute underline" data-testid="download-diagnostic">Download a diagnostic file to send to support</button>}
        </div>
        <aside className="rounded-lg bg-band p-4 text-[13px]">
          <div className="label mb-2">Which Odoo export?</div>
          <ol className="list-decimal space-y-2 pl-4">
            <li><b>Best:</b> Accounting → Reporting → <b>Trial Balance</b>, with monthly comparison periods → Export to XLSX. Includes opening balances.</li>
            <li><b>Profit and Loss</b> + <b>Balance Sheet</b> with monthly comparison → Export XLSX (both sheets in one workbook, or upload the P&amp;L and add the BS later).</li>
            <li><b>Journal Items</b> (posted, all dates) with Account, Date, Debit, Credit columns.</li>
          </ol>
          <p className="mt-3 text-mute">Nothing is uploaded until you confirm. Budget, variance and total columns are skipped automatically.</p>
        </aside>
      </div>
    );
  }

  return (
    <div data-testid="review">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <FileSpreadsheet className="h-5 w-5 text-green-d" />
        <span className="font-medium">{file?.name}</span>
        <button onClick={() => { setRaw(null); setFile(null); }} className="text-sm text-mute underline">Choose another file</button>
      </div>
      <div className="mb-5 grid gap-4 sm:grid-cols-4">
        <Stat label="Months" value={res.periods.length ? `${res.periods.length}` : "0"} sub={res.periods.length ? `${mlabel(res.periods[0])} – ${mlabel(lastP!)}` : ""} />
        <Stat label="Accounts mapped" value={`${lines.filter((l) => l.cls && !l.excluded).length} / ${lines.length}`} sub={`${review.length} to review`} tone={review.length ? "warn" : "ok"} />
        <Stat label={`Revenue ${lastP ? mlabel(lastP) : ""}`} value={lastP ? money(res.totals.revenue[lastP] ?? 0, currency) : "–"} sub="compare with your Odoo report" />
        <Stat label="Balance sheet" value={maxImb < 1 ? "Balances" : `Out by ${money(maxImb, currency)}`} tone={maxImb < 1 ? "ok" : "bad"} sub={lastP ? `cash ${money(res.totals.cash[lastP] ?? 0, currency)}` : ""} />
      </div>
      {(res.issues.warnings.length > 0 || res.issues.flips.length > 0 || res.issues.notes.length > 0) && (
        <div className="mb-5 space-y-1.5 text-[13px]">
          {res.issues.warnings.map((w) => <div key={w} className="flex gap-2 rounded bg-amber/15 px-3 py-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#9a6b00]" />{w}</div>)}
          {[...res.issues.flips, ...res.issues.notes].map((w) => <div key={w} className="flex gap-2 rounded bg-band px-3 py-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-d" />{w}</div>)}
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-line px-4 py-3 text-sm">
        <label className="flex items-center gap-2">P&amp;L columns are year-to-date
          <select value={opts.ytd} onChange={(e) => setOpts({ ...opts, ytd: e.target.value as IngestOptions["ytd"] })} className="rounded border border-line px-1.5 py-0.5">
            <option value="auto">Detect ({res.detected.ytd ? "yes" : "no"})</option><option value="yes">Yes</option><option value="no">No</option>
          </select></label>
        <label className="flex items-center gap-2">Close current-year earnings
          <select value={String(opts.closeEarnings)} onChange={(e) => setOpts({ ...opts, closeEarnings: e.target.value === "auto" ? "auto" : e.target.value === "true" })} className="rounded border border-line px-1.5 py-0.5">
            <option value="auto">Detect ({res.detected.unclosedEarnings ? "yes" : "no"})</option><option value="true">Yes</option><option value="false">No</option>
          </select></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={opts.plugEquity} onChange={(e) => setOpts({ ...opts, plugEquity: e.target.checked })} /> Force balance into Other Equity (last resort)</label>
      </div>
      <div className="mb-2 flex items-center gap-2 text-sm">
        {(["review", "all", "excluded"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("rounded-full px-3 py-1", filter === f ? "bg-ink text-white" : "bg-band")}>
            {f === "review" ? `Needs review (${review.length})` : f === "all" ? `All lines (${lines.length})` : `Excluded (${lines.filter((l) => l.excluded).length})`}
          </button>
        ))}
      </div>
      <div className="-mx-4 max-h-[52vh] overflow-auto px-4">
        <table className="tbl text-[13px]">
          <thead className="sticky top-0 bg-white"><tr><th>Account</th><th>Section</th><th>Maps to</th><th>Confidence</th><th>{lastP ? mlabel(lastP) : "Last value"}</th></tr></thead>
          <tbody>
            {shown.map((l) => {
              const k = normLabel(l.label);
              return (
                <tr key={l.key} className={cn("row", l.excluded && "opacity-50")}>
                  <td><div className="text-xs text-mute">{l.code}{l.sheet ? ` · ${l.sheet}` : ""}</div>{l.name}</td>
                  <td className="max-w-40 truncate text-mute">{l.section || "–"}</td>
                  <td>
                    <select value={l.excluded ? "" : l.cls ?? ""} onChange={(e) => setCls(k, e.target.value as ClassKey | "")} aria-label={`Class for ${l.name}`}
                      className={cn("max-w-56 rounded border px-1.5 py-1 text-left", !l.cls || l.excluded ? "border-red/50" : "border-line")}>
                      <option value="">— Exclude —</option>
                      <optgroup label="Profit & Loss">{CLASS_OPTIONS.slice(0, 14).map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</optgroup>
                      <optgroup label="Balance Sheet">{CLASS_OPTIONS.slice(14).map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</optgroup>
                    </select>
                  </td>
                  <td><span className={cn("rounded px-1.5 py-0.5 text-xs", l.conf >= 0.85 ? "bg-green-bg text-green-d" : l.conf >= 0.6 ? "bg-amber/20 text-[#9a6b00]" : "bg-red-bg text-red")} title={l.why}>{Math.round(l.conf * 100)}%</span> <span className="text-xs text-mute">{l.why}</span></td>
                  <td>{lastP && l.values[lastP] !== undefined ? money(l.values[lastP], currency) : "–"}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={5} className="py-6 text-center text-mute">{filter === "review" ? "Everything is mapped with good confidence." : "Nothing here."}</td></tr>}
          </tbody>
        </table>
      </div>
      {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
        <span className="mr-auto text-xs text-mute">{demo ? "Demo mode: your file was read in this browser only and nothing was saved." : "Your mapping choices are remembered for the next upload."}</span>
        {demo ? (
          <a href="/login?mode=signup" className="rounded bg-green-d px-5 py-2.5 font-medium text-white" data-testid="commit-import">Create a free account to import</a>
        ) : <button disabled={saving || !res.periods.length} onClick={commit} className="rounded bg-green-d px-5 py-2.5 font-medium text-white disabled:opacity-50" data-testid="commit-import">
          {saving ? "Importing…" : `Import ${res.periods.length} months`}
        </button>}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" | "warn" }) {
  return (
    <div className={cn("rounded-md border-t-[3px] bg-band px-3 py-2.5", tone === "bad" ? "border-red" : tone === "warn" ? "border-amber" : "border-green")}>
      <div className="label">{label}</div>
      <div className="num text-lg">{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

interface Diagnostic { file: string; size: number; sheets: { name: string; rows: number; cols: number; head: string[][] }[]; warnings: string[]; skipped: string[] }

/** Layout-only summary (first rows, truncated cells) to diagnose files the importer can't read. */
function diagnostic(f: File, grids: { name: string; rows: unknown[][] }[], issues: { warnings: string[]; skippedCols: string[] }): Diagnostic {
  return {
    file: f.name, size: f.size, warnings: issues.warnings, skipped: issues.skippedCols,
    sheets: grids.map((g) => ({
      name: g.name, rows: g.rows.length, cols: Math.max(0, ...g.rows.map((r) => r?.length ?? 0)),
      head: g.rows.slice(0, 15).map((r) => (r ?? []).slice(0, 16).map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null || c === undefined ? "" : String(c).slice(0, 60)))),
    })),
  };
}

function downloadDiagnostic(d: Diagnostic) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `import-diagnostic-${d.file.replace(/[^\w.-]+/g, "_")}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
