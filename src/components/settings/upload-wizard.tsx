"use client";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { mlabel, money, type ClassKey } from "@/lib/engine";
import { extractAll, materialUnmapped, runIngest, toAccountInputs, type IngestOptions, type IngestResult } from "@/lib/ingest/pipeline";
import type { Grid, Overrides, RawLine } from "@/lib/ingest/extract";
import { cellRef, fixRecords, type FixRecord } from "@/lib/ingest/trace";
import { financialIssues, finalTrace, salesIssues, sortedFinancials } from "@/lib/ingest/sorted";
import { financialsFill, salesCsv } from "@/lib/templates/fill";
import { RawSheets, ROLE, type RawSheetData } from "@/components/upload/raw-sheet";
import { SortedView, type Focus, type SortedViewProps } from "@/components/upload/sorted-view";
import { StepStrip, TwoBox } from "@/components/upload/two-box";
import { FileReading } from "./file-reading";
import { normLabel } from "@/lib/ingest/parse";
import { readWorkbooks } from "@/lib/ingest/read";
import { commitImport, previewImport, type PreviewResult } from "@/app/company/[id]/settings/actions";
import { checkKey, groupChecks, runChecks, type Check } from "@/lib/company/checks";
import type { ImportMode } from "@/lib/company/import-plan";
import { CheckList, ModeChoice, OverwriteDiffs, Timeline } from "./import-timeline";
import { cn } from "@/lib/cn";
import { readSalesGrid, salesFromLedger, type SalesOverride } from "@/lib/ingest/sales";
import { saveSales } from "@/lib/company/save-sales";
import { FIELD_LABEL, readSales, SalesPreview } from "./sales-preview";
import { isPdfLike } from "@/lib/ingest/pdf-client";
import { PdfRead, type PdfSummary } from "./pdf-read";
import { isTemplateGrid } from "@/lib/ingest/template";
import { TemplateButton } from "@/components/setup/readiness-view";

const FILE_CHECKS = new Set<Check["id"]>(["control_total", "duplicate", "tb_zero", "account_rollforward", "cross_check", "future_dated", "partial_month"]);

export function UploadWizard({ companyId, currency, fyStart, savedMapping, demo = false, setupStep }: { companyId: string; currency: string; fyStart: number; savedMapping: Record<string, string>; hasData?: boolean; demo?: boolean; setupStep?: "financials" | "sales" }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [grids, setGrids] = useState<Grid[] | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [opts, setOpts] = useState<Omit<IngestOptions, "mapping">>({ fyStart, ytd: "auto", closeEarnings: "auto", plugEquity: false });
  const [mapping, setMapping] = useState<Record<string, ClassKey | "">>(savedMapping as Record<string, ClassKey | "">);
  const [saving, start] = useTransition();
  const [step, setStep] = useState<"map" | "timeline">("map");
  const [mode, setMode] = useState<ImportMode>("merge");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [acceptOn, setAcceptOn] = useState(false);
  const [reason, setReason] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Sales exports (invoice lines or a pivot) uploaded alongside, or instead of, the accounting files.
  const [salesGrids, setSalesGrids] = useState<Grid[] | null>(null);
  const [salesOv, setSalesOv] = useState<Record<string, SalesOverride>>({});
  const salesRead = useMemo(() => (salesGrids ? readSales(salesGrids, salesOv) : null), [salesGrids, salesOv]);
  // PDFs and scanned images are read page by page and checked by the person before joining the spreadsheets.
  const [pdfJob, setPdfJob] = useState<{ files: File[]; sheets: Grid[] } | null>(null);
  const [pdfSummary, setPdfSummary] = useState<PdfSummary | null>(null);
  // The row or line the person is looking at in the two boxes.
  const [focus, setFocus] = useState<Focus | null>(null);
  const [picked, setPicked] = useState<SortedViewProps["picked"]>(null);

  /** Sheets from the files (spreadsheets, or tables read from PDF pages) go to the sales reader or the accounting reader. */
  const [notice, setNotice] = useState<string | null>(null);
  const takeSheets = useCallback((fs: File[], grids: Grid[]) => {
    // iReport templates' mistakes are shown on the sheet and fixed in the box beside it, like any other file's.
    const sales = grids.filter((g) => readSalesGrid(g));
    const accounting = grids.filter((g) => !sales.includes(g));
    if (sales.length) setSalesGrids(sales);
    // Opened from a setup step: say so when the file is not the kind that step asks for.
    const meaningful = accounting.filter((g) => isTemplateGrid(g) || g.rows.some((r) => r?.some((v) => typeof v === "number")));
    setNotice(setupStep === "sales" && !sales.length ? "This file has no sales lines (it looks like accounting figures), so it is read as financials. For sales, upload the Invoice Analysis export or the sales template."
      : setupStep === "financials" && !meaningful.length && sales.length ? "This file holds sales lines, not financial statements: only the sales are saved. For the P&L and balance sheet, upload the General Ledger or the financials template." : null);
    if (!accounting.length) { setGrids(null); return; }
    const { raw: lines, issues } = extractAll(accounting);
    setDiag(diagnostic(fs, accounting, issues));
    const broken = issues.layouts.some((l) => l.cellErrors?.length);
    if (!lines.length && !broken) throw new Error(issues.warnings[0] ?? "No usable rows found. See the tips on the right for the export formats that work best.");
    setOverrides({}); setGrids(accounting); setFocus(null); setPicked(null);
  }, [setupStep]);

  // Several files are read as one upload: a General Ledger gives the months, a Trial Balance or P&L for the same period checks them.
  const onFiles = useCallback(async (fs: File[]) => {
    setErr(null); setBusy(true); setFiles(fs); setDiag(null); setStep("map"); setPreview(null); setSalesGrids(null); setSalesOv({}); setFocus(null); setPicked(null);
    try {
      if (!fs.length) throw new Error("Choose a file.");
      if (fs.length > 6) throw new Error("Upload up to 6 files at a time.");
      if (fs.reduce((a, f) => a + f.size, 0) > 40 * 1024 * 1024 || fs.some((f) => f.size > 25 * 1024 * 1024)) throw new Error("That upload is too large (25 MB per file, 40 MB in all). Export a shorter date range or the monthly Trial Balance instead of journal items.");
      const pdfs = fs.filter(isPdfLike), sheets = fs.filter((f) => !isPdfLike(f));
      if (pdfs.length && demo) throw new Error("Reading PDFs and scanned pages needs a free account: each page is read by Claude. In the demo, upload an Excel or CSV export.");
      let grids: Grid[] = [];
      if (sheets.length) {
        try { grids = await readWorkbooks(await Promise.all(sheets.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })))); }
        catch { throw new Error(`${sheets.length > 1 ? "One of these files" : "This file"} couldn't be opened as a spreadsheet. Save it as .xlsx or .csv and try again.`); }
      }
      setPdfSummary(null);
      if (pdfs.length) { setGrids(null); setPdfJob({ files: pdfs, sheets: grids }); return; }
      takeSheets(fs, grids);
    } catch (e) {
      console.error("upload read failed", e);
      setErr((e as Error).message || "The file could not be read."); setGrids(null);
    } finally { setBusy(false); }
  }, [demo, takeSheets]);
  const stepHelp = setupStep === "sales"
    ? { title: "Step: sales lines", text: "Upload Odoo's Invoice Analysis export (list view: Invoice Date, Number, Partner, Product, Product Category, Salesperson, Quantity, Untaxed Total, Margin) or the filled sales template.", kind: "sales" as const }
    : setupStep === "financials" ? { title: "Step: monthly financials", text: "Upload Odoo's General Ledger for the financial year (with Initial Balance), optionally with the Trial Balance and P&L for the same dates, or the filled monthly financials template.", kind: "financials" as const } : null;

  function pdfDone(pdfGrids: Grid[], summary: PdfSummary) {
    const job = pdfJob;
    setPdfJob(null); setPdfSummary(summary); setErr(null);
    try { takeSheets(files, [...(job?.sheets ?? []), ...pdfGrids]); }
    catch (e) { setErr((e as Error).message || "The figures could not be read."); setGrids(null); }
  }

  // Re-read the workbook whenever the user corrects how a sheet or column is interpreted.
  const [res, ingestErr, raw]: [IngestResult | null, string | null, RawLine[]] = useMemo(() => {
    if (!grids) return [null, null, []];
    try {
      const { raw, issues } = extractAll(grids, overrides);
      return [runIngest(raw, issues, { ...opts, mapping }), null, raw];
    } catch (e) { console.error("ingest failed", e); return [null, (e as Error).message || "The file could not be analysed.", []]; }
  }, [grids, overrides, opts, mapping]);

  const setCls = (labelKey: string, cls: ClassKey | "") => setMapping((m) => ({ ...m, [labelKey]: cls }));
  const lines = res?.lines.filter((l) => !l.system) ?? [];
  const review = lines.filter((l) => !l.cls || (l.conf < 0.7 && !l.excluded));
  const lastP = res?.periods[res.periods.length - 1];
  const maxImb = res ? Math.max(0, ...Object.values(res.imbalance).map(Math.abs)) : 0;
  // Problems visible before the server preview: double counting, unbalanced debits/credits, totals that differ from the file.
  const fileChecks = useMemo(() => {
    if (!res) return [];
    const accts = toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) }));
    return runChecks({ accounts: accts, controls: res.controls, extra: res.checks }).filter((c) => FILE_CHECKS.has(c.id));
  }, [res]);
  const controlCount = res?.controls.length ?? 0;

  // ---- the two boxes: the file as uploaded (left) and iReport's sorted reading (right), with fixes made in the box.
  const [downloading, setDownloading] = useState(false);
  const [showFile, setShowFile] = useState(0);
  const sorted = useMemo(() => (res ? sortedFinancials(res, raw) : null), [res, raw]);
  const issues = useMemo(() => [...(res ? financialIssues(res, fileChecks) : []), ...(salesRead ? salesIssues(salesRead.layouts) : [])], [res, fileChecks, salesRead]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const isSalesSheet = (sheet: string) => !!salesGrids?.some((g) => g.name === sheet);
  const fixAt = (sheet: string, f: (o: { cells?: Record<string, number | string | null>; skipRows?: number[] }) => { cells?: Record<string, number | string | null>; skipRows?: number[] }) => {
    setPreview(null);
    if (isSalesSheet(sheet)) setSalesOv((o) => ({ ...o, [sheet]: { ...o[sheet], ...f(o[sheet] ?? {}) } }));
    else setOverrides((o) => ({ ...o, [sheet]: { ...o[sheet], ...f(o[sheet] ?? {}) } }));
  };
  const onCell = (sheet: string, row: number, col: number, value: number | string | null) => fixAt(sheet, (o) => ({ cells: { ...o.cells, [`${row}:${col}`]: value } }));
  const onSkipRow = (sheet: string, row: number) => fixAt(sheet, (o) => ({ skipRows: [...new Set([...(o.skipRows ?? []), row])] }));
  const onClass = (key: string, cls: ClassKey | "") => { const l = res?.lines.find((x) => x.key === key); if (l) setCls(normLabel(l.label), cls); };
  const rawSheets: RawSheetData[] = useMemo(() => {
    const out: RawSheetData[] = [];
    for (const l of res?.layouts ?? []) {
      const g = grids?.find((x) => x.name === l.sheet);
      if (!g) continue;
      const colNo = l.colNo ?? [];
      const heads: Record<number, string> = {}, leftOut: number[] = [];
      for (const c of l.columns) { const orig = colNo[c.col] ?? c.col; if (c.used && c.period) heads[orig] = c.period; else if (!c.used) leftOut.push(orig); }
      out.push({ name: l.sheet, rows: g.rows, origin: g.origin, trace: finalTrace(l, res), errors: l.cellErrors ?? [], heads, leftOut });
    }
    for (const l of salesRead?.layouts ?? []) {
      const g = salesGrids?.find((x) => x.name === l.sheet);
      if (!g) continue;
      const heads: Record<number, string> = {};
      for (const c of l.columns) { if (c.period) heads[c.col] = c.period; else if (c.field) heads[c.col] = FIELD_LABEL[c.field]; }
      out.push({ name: l.sheet, rows: g.rows, origin: g.origin, trace: l.trace, errors: l.errors, heads });
    }
    return out;
  }, [res, grids, salesRead, salesGrids]);
  /** A row clicked on the left: the line it became on the right, or why it was not used. */
  const onRow = (sheet: string, row: number) => {
    const s = rawSheets.find((x) => x.name === sheet);
    const t = s?.trace[row];
    const where = `${sheet.split(" › ").pop()}, ${cellRef(row, undefined, s?.origin)}`;
    setFocus({ sheet, rows: [row] });
    if (!t) { setPicked({ note: `${where}: empty.` }); return; }
    const role = ROLE[t.role];
    const used = t.role === "account" || t.role === "entry" || t.role === "opening";
    setPicked({ key: t.ref, sheet, row, note: `${where}: ${role.label.toLowerCase()}${t.note ? `, ${t.note}` : ""}.${used ? " Highlighted on the right." : ""}` });
  };
  const fixes = (): FixRecord[] => [
    ...Object.entries(overrides).flatMap(([sheet, o]) => fixRecords(sheet, grids?.find((g) => g.name === sheet)?.rows ?? [], o)),
    ...Object.entries(salesOv).flatMap(([sheet, o]) => fixRecords(sheet, salesGrids?.find((g) => g.name === sheet)?.rows ?? [], o)),
  ].slice(0, 500);
  /** The sorted reading as iReport's own template: the financials as a filled workbook, sales lines as the sales template (CSV). */
  async function download() {
    setDownloading(true); setErr(null);
    try {
      const save = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); Object.assign(document.createElement("a"), { href: url, download: name }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      if (sorted && (sorted.plPeriods.length || sorted.bsPeriods.length)) {
        const r = await fetch("/api/templates/financials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currency: /^[A-Z]{3}$/.test(currency) ? currency : "EGP", fy: fyStart, ...financialsFill(sorted) }) });
        if (!r.ok) throw new Error("The template could not be prepared.");
        save(await r.blob(), "ireport-financials-filled.xlsx");
      }
      if (salesRead?.lines.length) save(new Blob([salesCsv(salesRead.lines, currency)], { type: "text/csv;charset=utf-8" }), "ireport-sales-filled.csv");
    } catch (e) { setErr((e as Error).message); } finally { setDownloading(false); }
  }
  const box = (
    <TwoBox
      leftSub={`${rawSheets.length} sheet${rawSheets.length === 1 ? "" : "s"} · click a row to see what it became`}
      rightTone={errorCount ? "bad" : "ok"} showFile={showFile}
      left={<RawSheets sheets={rawSheets} focus={focus} onRow={onRow} />}
      right={<SortedView fin={sorted} sales={salesRead?.lines ?? null} issues={issues} currency={currency} origin={(sh) => rawSheets.find((x) => x.name === sh)?.origin}
        picked={picked} onFocus={(f, o) => { setFocus(f); if (f && !o?.stay) setShowFile((n) => n + 1); }} onClass={onClass} onCell={onCell} onSkipRow={onSkipRow} onDownload={download} downloading={downloading} />}
    />
  );

  /** Everything the server needs to plan this import (the merge itself and the checks run on the server). */
  function payload(m: ImportMode) {
    if (!res) return null;
    const accounts = toAccountInputs(res);
    if (!accounts.length) return null;
    const extra: Check[] = [...res.checks];
    const unm = materialUnmapped(res);
    for (const st of ["PL", "BS"] as const) {
      const ls = unm.filter((l) => (l.stmt ?? "PL") === st);
      if (ls.length) extra.push({ id: "unmapped", severity: "block", statement: st, title: `${ls.length} material line${ls.length > 1 ? "s are" : " is"} not mapped`, detail: `${ls.slice(0, 4).map((l) => `'${l.name}'`).join(", ")}${ls.length > 4 ? "…" : ""}. Choose a class for each, or exclude it if it is a total or not an account.` });
    }
    return { companyId, mode: m, slices: res.slices, accounts, extra, controls: res.controls, ranges: res.ranges, openingFrom: res.openingFrom };
  }

  async function runPreview(m: ImportMode = mode) {
    const p = payload(m);
    if (!p) { setErr("Nothing to import: every line is excluded or has no amounts. Map at least one account."); return; }
    setErr(null); setPreviewing(true);
    try {
      const out = await previewImport(p);
      if (!out.ok) { setErr(out.error); return; }
      setPreview(out.data); setStep("timeline"); setAcceptOn(false);
    } catch (e) {
      console.error("preview failed", e);
      setErr(`The import could not be checked (${(e as Error).message || "network error"}).`);
    } finally { setPreviewing(false); }
  }

  const blocking = preview?.checks.filter((c) => c.severity === "block" && !c.accepted && !c.existing) ?? [];

  async function commit() {
    const p = payload(mode);
    if (!res || !files.length || !p) return;
    if (mode === "replace" && preview?.hasData && !confirm("Replace everything: all current months are removed and only this file is kept. You can undo this from Data health. Continue?")) return;
    setErr(null);
    start(async () => {
      try {
        const out = await commitImport({
          ...p, filename: files.map((f) => f.name).join(" + ").slice(0, 300),
          report: { kind: res.kind, periods: res.periods, warnings: res.issues.warnings, notes: res.issues.notes, flips: res.issues.flips, ...(res.asOf ? { asOf: res.asOf } : {}), ...(pdfSummary ? { pdf: pdfSummary } : {}), mapping: Object.fromEntries(Object.entries(mapping).filter(([k]) => !k.includes("|"))), fixes: fixes() },
          accept: blocking.length && acceptOn ? { keys: blocking.map(checkKey), reason } : undefined,
        });
        if (!out.ok) { setErr(out.error); return; }
        // The General Ledger's invoice lines become sales; a sales file uploaded with it is saved too.
        const filename = files.map((f) => f.name).join(" + ");
        for (const [source, ls] of [["ledger", salesFromLedger(res.lines)], ["file", salesRead?.lines ?? []]] as const) {
          const saved = await saveSales(companyId, source, [...ls], filename);
          if (!saved.ok) { setErr(`The figures were imported, but the sales could not be saved: ${saved.error}`); return; }
        }
        router.push(`/company/${companyId}/settings/data-health?imported=1`);
        router.refresh();
      } catch (e) {
        console.error("import failed", e);
        setErr(`The import could not be saved (${(e as Error).message || "network error"}). If the file is very large, export a shorter date range and try again.`);
      }
    });
  }

  if (pdfJob) return <PdfRead companyId={companyId} files={pdfJob.files} onDone={pdfDone} onCancel={() => { setPdfJob(null); setFiles([]); }} />;

  if (!res && salesRead && (salesRead.lines.length || salesRead.layouts.some((l) => l.errors.length))) {
    return (
      <div data-testid="sales-only">
        <StepStrip at={2} />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <FileSpreadsheet className="h-5 w-5 text-brand-d" />
          <span className="font-medium">{files.map((f) => f.name).join(" + ")}</span>
          <button onClick={() => { setSalesGrids(null); setFiles([]); }} className="text-sm text-mute underline">Choose other files</button>
        </div>
        {notice && <p className="mb-4 rounded bg-amber/15 px-3 py-2 text-[13px]" data-testid="upload-notice">{notice}</p>}
        <SalesPreview read={salesRead} currency={currency} overrides={salesOv} onChange={setSalesOv} />
        <div className="mt-5">{box}</div>
        {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          <span className="mr-auto text-xs text-mute">{errorCount ? `Fix the ${errorCount} error${errorCount > 1 ? "s" : ""} in the box above to save.` : demo ? "Demo mode: your file was read in this browser only and nothing was saved." : "Only sales are saved from this file; the financial figures are not changed."}</span>
          {!demo && (
            <button disabled={saving || errorCount > 0 || !salesRead.lines.length} data-testid="save-sales" className="rounded bg-brand-d px-5 py-2.5 font-medium text-white disabled:opacity-50"
              onClick={() => start(async () => {
                setErr(null);
                const out = await saveSales(companyId, "file", salesRead.lines, files.map((f) => f.name).join(" + "), { layouts: salesRead.layouts.map((l) => ({ sheet: l.sheet, kind: l.kind, lines: l.lines, total: l.total, taxIncluded: l.taxIncluded })), fixes: fixes() });
                if (!out.ok) { setErr(out.error); return; }
                router.push(`/company/${companyId}/sales`);
                router.refresh();
              })}>
              {saving ? "Saving…" : `Save ${salesRead.lines.length.toLocaleString("en-US")} sales lines`}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!res) {
    return (
      <>
      {stepHelp && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-brand/40 bg-brand-bg/40 px-4 py-3 text-sm" data-testid="upload-step">
          <div className="min-w-0 flex-1"><b>{stepHelp.title}.</b> {stepHelp.text}</div>
          <TemplateButton kind={stepHelp.kind} compact />
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files); if (fs.length) onFiles(fs); }}
          onClick={() => input.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line px-6 py-16 text-center transition hover:border-brand hover:bg-brand-bg/20"
          data-testid="dropzone"
        >
          {busy ? <Loader2 className="h-10 w-10 animate-spin text-brand" /> : <Upload className="h-10 w-10 text-brand" strokeWidth={1.5} />}
          <div className="mt-3 text-lg">{busy ? `Reading ${files.map((f) => f.name).join(", ")}…` : "Drop Odoo exports here, or click to choose"}</div>
          <div className="mt-1 text-sm text-mute">One or several files · accounting reports or sales exports · .xlsx, .xls, .csv, .txt, or .pdf (scanned or digital) · English or Arabic</div>
          <input ref={input} type="file" multiple accept=".xlsx,.xls,.csv,.txt,.tsv,.pdf,.jpg,.jpeg,.png" className="hidden" data-testid="file-input" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) onFiles(fs); e.target.value = ""; }} />
          {(err || ingestErr) && <p className="mt-4 max-w-xl whitespace-pre-line rounded bg-red-bg px-3 py-2 text-left text-sm text-red" role="alert" data-testid="upload-error" onClick={(e) => e.stopPropagation()}>{err || ingestErr}</p>}
          {(err || ingestErr) && diag && <button type="button" onClick={(e) => { e.stopPropagation(); downloadDiagnostic(diag); }} className="mt-2 text-xs text-mute underline" data-testid="download-diagnostic">Download a diagnostic file to send to support</button>}
        </div>
        <aside className="rounded-lg bg-band p-4 text-[13px]">
          <div className="label mb-2">Which Odoo export?</div>
          <ol className="list-decimal space-y-2 pl-4">
            <li><b>Best:</b> Accounting → Reporting → <b>General Ledger</b> for the year → Export XLSX. It gives every month and the opening balances.</li>
            <li>Add the <b>Trial Balance</b> and <b>Profit and Loss</b> for the same dates in the same upload: they are used to prove the figures, account by account, and are not counted twice.</li>
            <li>Or a <b>Trial Balance</b> / <b>P&amp;L</b> + <b>Balance Sheet</b> with monthly comparison periods, or <b>Journal Items</b> (Account, Date, Debit, Credit).</li>
            <li><b>For Sales:</b> the General Ledger already gives sales by customer and product. Add Sales → Reporting → <b>Sales</b> or Invoicing → Reporting → <b>Invoice Analysis</b> (list view → Export) for quantities, salespeople and margins.</li>
          </ol>
          <p className="mt-3"><b>Only have a PDF?</b> Printed or scanned statements, trial balances and sales reports can be uploaded too. Each page is read by Claude (Anthropic) and is not kept; you check the figures before anything is imported. Excel exports remain the most exact.</p>
          <p className="mt-3"><b>No Odoo?</b> Use iReport&apos;s templates: each is read exactly, and any mistake is listed with its sheet and row.</p>
          <div className="mt-2 flex flex-col items-start gap-2"><TemplateButton kind="financials" compact /><TemplateButton kind="sales" compact /></div>
          <p className="mt-3 text-mute">Spreadsheets are read in your browser and nothing is saved until you confirm. Budget, variance and total columns are skipped automatically.</p>
        </aside>
      </div>
      </>
    );
  }

  if (step === "timeline" && preview) {
    const canImport = !blocking.length || (acceptOn && reason.trim().length >= 10);
    return (
      <div data-testid="timeline-step" className="space-y-5">
        <StepStrip at={3} />
        <div className="flex flex-wrap items-center gap-3">
          <FileSpreadsheet className="h-5 w-5 text-brand-d" />
          <span className="font-medium">{files.map((f) => f.name).join(" + ")}</span>
          <button onClick={() => setStep("map")} className="text-sm text-mute underline">Back to mapping</button>
        </div>
        <section className="space-y-3">
          <h2 className="text-lg font-medium">What this import changes</h2>
          <p className="text-sm text-mute">This file covers {sliceText(res.slices)}.</p>
          <ModeChoice mode={mode} hasData={preview.hasData} onChange={(m) => { setMode(m); runPreview(m); }} />
          <Timeline cells={preview.timeline} checks={preview.checks} />
          <OverwriteDiffs diffs={preview.diffs} currency={currency} />
        </section>
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Checks</h2>
          <CheckList checks={preview.checks} />
          {blocking.length > 0 && (
            <div className="rounded-md border border-red/40 p-3 text-sm" data-testid="accept-box">
              <p className="mb-2">The import is stopped until {groupChecks(blocking).length === 1 ? "this issue is" : `these ${groupChecks(blocking).length} issues are`} fixed: go back to the mapping, or import anyway and record why. The reason is shown on Data health and in report notes.</p>
              <label className="flex items-center gap-2"><input type="checkbox" checked={acceptOn} onChange={(e) => setAcceptOn(e.target.checked)} data-testid="accept-check" /> Import anyway</label>
              {acceptOn && <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Why these figures are right, e.g. 'Odoo's own balance sheet is out by this suspense balance; being fixed by the accountant.'" className="mt-2 w-full rounded border border-line px-2 py-1.5" data-testid="accept-reason" />}
            </div>
          )}
        </section>
        {err && <p className="rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          <span className="mr-auto text-xs text-mute">{preview.accounts} accounts will be stored. The previous data stays available to restore from Data health.</span>
          <button disabled={saving || previewing || !canImport} onClick={commit} className="rounded bg-brand-d px-5 py-2.5 font-medium text-white disabled:opacity-50" data-testid="commit-import">
            {saving ? "Importing…" : previewing ? "Checking…" : mode === "replace" && preview.hasData ? "Replace data" : "Import"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="review">
      <StepStrip at={2} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FileSpreadsheet className="h-5 w-5 text-brand-d" />
        <span className="font-medium">{files.map((f) => f.name).join(" + ")}</span>
        <button onClick={() => { setGrids(null); setFiles([]); }} className="text-sm text-mute underline">Choose other files</button>
      </div>
      {notice && <p className="mb-4 rounded bg-amber/15 px-3 py-2 text-[13px]" data-testid="upload-notice">{notice}</p>}
      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <Stat label="Months" value={res.periods.length ? `${res.periods.length}` : "0"} sub={res.periods.length ? `${mlabel(res.periods[0])} – ${mlabel(lastP!)}` : ""} />
        <Stat label="Accounts mapped" value={`${lines.filter((l) => l.cls && !l.excluded).length} / ${lines.length}`} sub={`${review.length} to review`} tone={review.length ? "warn" : "ok"} />
        <Stat label={`Revenue ${lastP ? mlabel(lastP) : ""}`} value={lastP ? money(res.totals.revenue[lastP] ?? 0, currency) : "–"} sub={res.asOf ? `part month, to ${Number(res.asOf.slice(8))} ${mlabel(lastP!).split(" ")[0]}` : "compare with your Odoo report"} />
        <Stat label="Balance sheet" value={maxImb < 1 ? "Balances" : `Out by ${money(maxImb, currency)}`} tone={maxImb < 1 ? "ok" : "bad"} sub={lastP ? `cash ${money(res.totals.cash[lastP] ?? 0, currency)}` : ""} />
      </div>
      <FileReading layouts={res.layouts} overrides={overrides} onChange={(o) => { setOverrides(o); setPreview(null); }} />
      <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2 rounded-md border border-line px-4 py-2.5 text-sm">
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
      {salesRead && salesRead.lines.length > 0 && <p className="mb-4 rounded bg-brand-bg px-3 py-2 text-[13px]" data-testid="sales-alongside">Also in this upload: a sales file ({salesRead.layouts.map((l) => l.sheet).join(", ")}) with {salesRead.lines.length.toLocaleString("en-US")} lines. It is saved to the Sales sector when you import.</p>}
      {res.lines.some((l) => l.entries?.length && l.cls === "revenue" && !l.excluded) && <p className="mb-4 text-[13px] text-mute" data-testid="ledger-sales-note">The invoice lines on revenue accounts become sales by customer, product and month in the Sales sector.</p>}
      {box}
      <div className="mt-4 space-y-2">
        {fileChecks.length > 0 && <CheckList checks={fileChecks} />}
        {controlCount > 0 && !fileChecks.some((c) => c.id === "control_total") && <p className="flex items-center gap-2 text-[13px] text-green-d" data-testid="controls-ok"><CheckCircle2 className="h-4 w-4" />Matches the totals printed in the file ({controlCount} total{controlCount > 1 ? "s" : ""} checked: net profit, total assets…).</p>}
        {(res.issues.warnings.length > 0 || res.issues.flips.length > 0 || res.issues.notes.length > 0) && (
          <div className="space-y-1.5 text-[13px]">
            {res.issues.warnings.map((w) => <div key={w} className="flex gap-2 rounded bg-amber/15 px-3 py-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#9a6b00]" />{w}</div>)}
            {[...res.issues.flips, ...res.issues.notes].map((w) => <div key={w} className="flex gap-2 rounded bg-band px-3 py-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-d" />{w}</div>)}
          </div>
        )}
      </div>
      {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
        <span className="mr-auto text-xs text-mute" data-testid="continue-hint">{errorCount ? `Fix the ${errorCount} error${errorCount > 1 ? "s" : ""} in the box above to continue: each one has its fix beside it.` : demo ? "Demo mode: your file was read in this browser only and nothing was saved." : "Your class choices are remembered for the next upload."}</span>
        {demo ? (
          <a href="/login?mode=signup" className="rounded bg-brand-d px-5 py-2.5 font-medium text-white" data-testid="commit-import">Create a free account to import</a>
        ) : <button disabled={previewing || !res.periods.length || errorCount > 0} onClick={() => runPreview()} className="rounded bg-brand-d px-5 py-2.5 font-medium text-white disabled:opacity-50" data-testid="continue-timeline">
          {previewing ? "Checking…" : `Continue: check ${res.periods.length} months`}
        </button>}
      </div>
    </div>
  );
}

function sliceText(s: { PL: string[]; BS: string[] }) {
  const r = (ps: string[]) => (ps.length === 1 ? mlabel(ps[0]) : `${mlabel(ps[0])} – ${mlabel(ps[ps.length - 1])}`);
  const parts = [s.PL.length ? `Profit & Loss for ${r(s.PL)}` : "", s.BS.length ? `Balance sheet for ${r(s.BS)}` : ""].filter(Boolean);
  return parts.join(" and ") || "no months";
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
function diagnostic(fs: File[], grids: { name: string; rows: unknown[][] }[], issues: { warnings: string[]; skippedCols: string[] }): Diagnostic {
  return {
    file: fs.map((f) => f.name).join(" + "), size: fs.reduce((a, f) => a + f.size, 0), warnings: issues.warnings, skipped: issues.skippedCols,
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
