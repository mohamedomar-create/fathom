"use client";
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { mlabel, money, type ClassKey } from "@/lib/engine";
import { extractAll, materialUnmapped, runIngest, toAccountInputs, type IngestOptions, type IngestResult } from "@/lib/ingest/pipeline";
import type { Grid, Overrides, RawLine } from "@/lib/ingest/extract";
import { cellRef, fixRecords, type FixRecord } from "@/lib/ingest/trace";
import { expenseIssues, financialIssues, finalTrace, salesIssues, sortedFinancials } from "@/lib/ingest/sorted";
import { expensesCsv, financialsFill, salesCsv } from "@/lib/templates/fill";
import { RawSheets, ROLE, type RawSheetData } from "@/components/upload/raw-sheet";
import { SortedView, type Focus, type SortedViewProps } from "@/components/upload/sorted-view";
import { TwoBox } from "@/components/upload/two-box";
import { ChoiceCard, WizardNav, WizardSteps, WizardTitle, type Screen } from "@/components/upload/wizard-shell";
import { ImportReadiness } from "@/components/setup/import-readiness";
import { useCompany } from "@/lib/company/context";
import { FileReading } from "./file-reading";
import { normLabel } from "@/lib/ingest/parse";
import { readWorkbooks } from "@/lib/ingest/read";
import { commitImport, previewImport, type PreviewResult } from "@/app/company/[id]/settings/actions";
import { checkKey, runChecks, type Check } from "@/lib/company/checks";
import type { ImportMode } from "@/lib/company/import-plan";
import { CheckList, OverwriteDiffs, Timeline } from "./import-timeline";
import { cn } from "@/lib/cn";
import { isPL } from "@/lib/company/build";
import { readSalesGrid, salesFromLedger, type SalesOverride } from "@/lib/ingest/sales";
import { saveSales } from "@/lib/company/save-sales";
import { FIELD_LABEL, readSales, SalesPreview } from "./sales-preview";
import { salesPeriods } from "@/lib/ingest/sales";
import { expensePeriods, expensesFromLedger, readExpenseGrid, type ExpenseOverride } from "@/lib/ingest/expenses";
import { saveExpenses } from "@/lib/company/save-expenses";
import { EXPENSE_FIELD_LABEL, ExpensesPreview, readExpenses } from "./expenses-preview";
import { isPdfLike } from "@/lib/ingest/pdf-client";
import { PdfRead, type PdfSummary } from "./pdf-read";
import { TemplateButton } from "@/components/setup/readiness-view";

type Kind = "accounts" | "sales" | "expenses";
const KIND_WORD: Record<Kind, string> = { accounts: "an accounts", sales: "a sales", expenses: "an expenses" };

const FILE_CHECKS = new Set<Check["id"]>(["control_total", "duplicate", "tb_zero", "account_rollforward", "cross_check", "future_dated", "partial_month"]);

/**
 * Upload, one step at a time: what you are uploading → where to get the file → upload → check (your file beside what
 * iReport reads, problems fixed one by one) → save (months already loaded: add only new ones, or replace them) → done.
 * salesLoaded / expensesLoaded: months that already have sales / expense lines from an uploaded file (to warn about duplicates).
 */
export function UploadWizard({ companyId, currency, fyStart, savedMapping, demo = false, setupStep, salesLoaded = [], expensesLoaded = [] }: { companyId: string; currency: string; fyStart: number; savedMapping: Record<string, string>; hasData?: boolean; demo?: boolean; setupStep?: "financials" | "sales" | "expenses"; salesLoaded?: string[]; expensesLoaded?: string[] }) {
  const router = useRouter();
  const company = useCompany();
  const [kind, setKind] = useState<Kind | null>(setupStep === "sales" ? "sales" : setupStep === "expenses" ? "expenses" : setupStep === "financials" ? "accounts" : null);
  const [screen, setScreen] = useState<Screen>(setupStep ? "get" : "what");
  const [modeChosen, setModeChosen] = useState(false);
  const [salesMode, setSalesMode] = useState<"add" | "replace" | null>(null);
  const [expMode, setExpMode] = useState<"add" | "replace" | null>(null);
  const [done, setDone] = useState<{ what: string } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [grids, setGrids] = useState<Grid[] | null>(null);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [opts, setOpts] = useState<Omit<IngestOptions, "mapping">>({ fyStart, ytd: "auto", closeEarnings: "auto", plugEquity: false });
  const [mapping, setMapping] = useState<Record<string, ClassKey | "">>(savedMapping as Record<string, ClassKey | "">);
  const [saving, start] = useTransition();
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
  // Purchases (vendor bills, the expenses template) uploaded alongside, or instead of, the accounting files.
  const [expGrids, setExpGrids] = useState<Grid[] | null>(null);
  const [expOv, setExpOv] = useState<Record<string, ExpenseOverride>>({});
  const expRead = useMemo(() => (expGrids ? readExpenses(expGrids, expOv) : null), [expGrids, expOv]);
  // PDFs and scanned images are read page by page and checked by the person before joining the spreadsheets.
  const [pdfJob, setPdfJob] = useState<{ files: File[]; sheets: Grid[] } | null>(null);
  const [pdfSummary, setPdfSummary] = useState<PdfSummary | null>(null);
  // The row or line the person is looking at in the two boxes.
  const [focus, setFocus] = useState<Focus | null>(null);
  const [picked, setPicked] = useState<SortedViewProps["picked"]>(null);

  /** Sheets from the files (spreadsheets, or tables read from PDF pages) go to the sales reader or the accounting reader. */
  const takeSheets = useCallback((fs: File[], grids: Grid[]) => {
    // iReport templates' mistakes are shown on the sheet and fixed in the box beside it, like any other file's.
    const expenses = grids.filter((g) => readExpenseGrid(g));
    const sales = grids.filter((g) => !expenses.includes(g) && readSalesGrid(g));
    const accounting = grids.filter((g) => !sales.includes(g) && !expenses.includes(g));
    if (sales.length) setSalesGrids(sales);
    if (expenses.length) setExpGrids(expenses);
    if (!accounting.length) { setGrids(null); setScreen("check"); return; }
    const { raw: lines, issues } = extractAll(accounting);
    setDiag(diagnostic(fs, accounting, issues));
    const broken = issues.layouts.some((l) => l.cellErrors?.length);
    // A sales or expenses file's other sheets (help text, notes) hold no figures: the lines alone are read.
    if (!lines.length && !broken && (sales.length || expenses.length)) { setGrids(null); setScreen("check"); return; }
    if (!lines.length && !broken) throw new Error(issues.warnings[0] ?? "No usable rows found. See the tips on the right for the export formats that work best.");
    setOverrides({}); setGrids(accounting); setFocus(null); setPicked(null); setScreen("check");
  }, []);

  // Several files are read as one upload: a General Ledger gives the months, a Trial Balance or P&L for the same period checks them.
  const onFiles = useCallback(async (fs: File[]) => {
    setErr(null); setBusy(true); setFiles(fs); setDiag(null); setPreview(null); setSalesGrids(null); setSalesOv({}); setExpGrids(null); setExpOv({}); setFocus(null); setPicked(null); setModeChosen(false); setSalesMode(null); setExpMode(null);
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
  const issues = useMemo(() => [...(res ? financialIssues(res, fileChecks) : []), ...(salesRead ? salesIssues(salesRead.layouts) : []), ...(expRead ? expenseIssues(expRead.layouts) : [])], [res, fileChecks, salesRead, expRead]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const isSalesSheet = (sheet: string) => !!salesGrids?.some((g) => g.name === sheet);
  const isExpenseSheet = (sheet: string) => !!expGrids?.some((g) => g.name === sheet);
  const fixAt = (sheet: string, f: (o: { cells?: Record<string, number | string | null>; skipRows?: number[] }) => { cells?: Record<string, number | string | null>; skipRows?: number[] }) => {
    setPreview(null);
    if (isSalesSheet(sheet)) setSalesOv((o) => ({ ...o, [sheet]: { ...o[sheet], ...f(o[sheet] ?? {}) } }));
    else if (isExpenseSheet(sheet)) setExpOv((o) => ({ ...o, [sheet]: { ...o[sheet], ...f(o[sheet] ?? {}) } }));
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
    for (const l of expRead?.layouts ?? []) {
      const g = expGrids?.find((x) => x.name === l.sheet);
      if (!g) continue;
      const heads: Record<number, string> = {};
      for (const c of l.columns) if (c.field) heads[c.col] = EXPENSE_FIELD_LABEL[c.field];
      out.push({ name: l.sheet, rows: g.rows, origin: g.origin, trace: l.trace, errors: l.errors, heads });
    }
    return out;
  }, [res, grids, salesRead, salesGrids, expRead, expGrids]);
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
    ...Object.entries(expOv).flatMap(([sheet, o]) => fixRecords(sheet, expGrids?.find((g) => g.name === sheet)?.rows ?? [], o)),
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
      if (expRead?.lines.length) save(new Blob([expensesCsv(expRead.lines, currency)], { type: "text/csv;charset=utf-8" }), "ireport-expenses-filled.csv");
    } catch (e) { setErr((e as Error).message); } finally { setDownloading(false); }
  }
  const box = (
    <TwoBox
      leftSub={`${rawSheets.length} sheet${rawSheets.length === 1 ? "" : "s"} · click a row to see what it became`}
      rightTone={errorCount ? "bad" : "ok"} showFile={showFile}
      left={<RawSheets sheets={rawSheets} focus={focus} onRow={onRow} />}
      right={<SortedView fin={sorted} sales={salesRead?.lines ?? null} expenses={expRead?.lines ?? null} issues={issues} currency={currency} origin={(sh) => rawSheets.find((x) => x.name === sh)?.origin}
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
      setPreview(out.data); setScreen("save"); setAcceptOn(false);
      // The file repeats loaded months with the very same figures: adding only the new months is the safe default.
      if (!modeChosen && m === "merge" && out.data.overlap.length && out.data.overlap.every((o) => o.same)) { setMode("add"); setModeChosen(true); void runPreview("add"); }
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
        // "Add only new months" keeps the sales of months already loaded as well.
        const filename = files.map((f) => f.name).join(" + ");
        const addedPL = new Set(preview?.timeline.filter((t) => t.PL === "new").map((t) => t.period) ?? []);
        const loadedSales = new Set(salesLoaded);
        const ledger = salesFromLedger(res.lines).filter((l) => mode !== "add" || addedPL.has(l.period));
        const fileSales = (salesRead?.lines ?? []).filter((l) => mode !== "add" || !loadedSales.has(l.period));
        for (const [source, ls] of [["ledger", ledger], ["file", fileSales]] as const) {
          const saved = await saveSales(companyId, source, [...ls], filename);
          if (!saved.ok) { setErr(`The figures were saved, but the sales could not be: ${saved.error}`); return; }
        }
        // The ledger's cost lines become expense lines (who was paid, for what); a purchases file is saved too.
        const loadedExp = new Set(expensesLoaded);
        const ledgerExp = expensesFromLedger(res.lines).filter((l) => mode !== "add" || addedPL.has(l.period));
        const fileExp = (expRead?.lines ?? []).filter((l) => mode !== "add" || !loadedExp.has(l.period));
        for (const [source, ls] of [["ledger", ledgerExp], ["file", fileExp]] as const) {
          const saved = await saveExpenses(companyId, source, [...ls], filename);
          if (!saved.ok) { setErr(`The figures were saved, but the expense lines could not be: ${saved.error}`); return; }
        }
        const months = new Set([...(preview?.timeline ?? [])].filter((t) => t.PL === "new" || t.PL === "overwrite" || t.BS === "new" || t.BS === "overwrite").map((t) => t.period));
        setDone({ what: `${months.size} month${months.size === 1 ? "" : "s"} saved` });
        setScreen("done");
        router.refresh();
      } catch (e) {
        console.error("import failed", e);
        setErr(`The import could not be saved (${(e as Error).message || "network error"}). If the file is very large, export a shorter date range and try again.`);
      }
    });
  }

  // ---- duplicates: months in the file that are already loaded
  const overlap = preview?.overlap ?? [];
  const overlapMonths = [...new Set(overlap.map((o) => o.period))].sort();
  const allSame = overlap.length > 0 && overlap.every((o) => o.same);
  const newMonths = res ? [...new Set([...res.slices.PL.filter((p) => !overlap.some((o) => o.statement === "PL" && o.period === p)), ...res.slices.BS.filter((p) => !overlap.some((o) => o.statement === "BS" && o.period === p))])].sort() : [];
  const choose = (m: ImportMode) => { setMode(m); setModeChosen(true); runPreview(m); };
  const salesOverlap = salesRead ? salesPeriods(salesRead.lines).filter((p) => salesLoaded.includes(p)) : [];
  const salesToSave = (salesRead?.lines ?? []).filter((l) => salesMode !== "add" || !salesLoaded.includes(l.period));
  const expOverlap = expRead ? expensePeriods(expRead.lines).filter((p) => expensesLoaded.includes(p)) : [];
  const expToSave = (expRead?.lines ?? []).filter((l) => expMode !== "add" || !expensesLoaded.includes(l.period));
  const reset = (k: Kind | null) => { setGrids(null); setSalesGrids(null); setExpGrids(null); setFiles([]); setPreview(null); setErr(null); setDone(null); setKind(k); setScreen(k ? "get" : "what"); };
  // The file holds another kind of data than the one picked: say so, and offer to switch.
  const found: Record<Kind, boolean> = { accounts: !!res, sales: !!salesRead?.lines.length, expenses: !!expRead?.lines.length };
  const wrongKind: Kind | null = kind && !found[kind] ? (["accounts", "sales", "expenses"] as Kind[]).find((k) => found[k]) ?? null : null;

  if (pdfJob) return <PdfRead companyId={companyId} files={pdfJob.files} onDone={pdfDone} onCancel={() => { setPdfJob(null); setFiles([]); }} />;

  // 1 · What are you uploading?
  if (screen === "what") {
    return (
      <div data-testid="wiz-what">
        <WizardSteps at="what" />
        <WizardTitle title="What are you uploading?" hint="Pick one." />
        <div className="grid max-w-4xl gap-3 sm:grid-cols-3">
          <ChoiceCard icon="📊" title="My accounts" sub="Profit and loss, and balance sheet." onClick={() => { setKind("accounts"); setScreen("get"); }} testId="pick-accounts" />
          <ChoiceCard icon="🧾" title="My sales" sub="Invoices: who bought what." onClick={() => { setKind("sales"); setScreen("get"); }} testId="pick-sales" />
          <ChoiceCard icon="💸" title="My expenses" sub="Bills and costs: who you pay." onClick={() => { setKind("expenses"); setScreen("get"); }} testId="pick-expenses" />
        </div>
      </div>
    );
  }

  // 2 · Get your file
  if (screen === "get") {
    const steps = kind === "sales"
      ? ["Open Odoo: Invoicing → Reporting → Invoice Analysis.", "Switch to the list view.", "Select all lines. Click Export."]
      : kind === "expenses"
        ? ["Open Odoo: Accounting → Reporting → Invoice Analysis.", "Filter: Vendor Bills. Switch to the list view.", "Select all lines. Click Export."]
        : ["Open Odoo: Accounting → Reporting → General Ledger.", "Pick dates: start of the year to today.", "Tick “Initial balance”. Click Export → Excel."];
    return (
      <div data-testid="wiz-get">
        <WizardSteps at="get" />
        <WizardTitle title={kind === "sales" ? "Get your sales file" : kind === "expenses" ? "Get your expenses file" : "Get your accounts file"} hint="Use Odoo, or our template." />
        {kind === "expenses" && (
          <p className="mb-4 flex max-w-4xl flex-wrap items-center gap-3 rounded-lg bg-green-bg px-4 py-3 text-[15px] text-green-d" data-testid="expenses-in-ledger">
            Your General Ledger already has your expenses.
            <button onClick={() => reset("accounts")} className="rounded bg-green-d px-3 py-1 text-sm text-white" data-testid="expenses-use-ledger">Upload my General Ledger</button>
            <span className="text-[13px] text-ink/70">Bills below add more detail.</span>
          </p>
        )}
        <div className="grid max-w-4xl gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-line p-5" data-testid="get-odoo">
            <h3 className="mb-3 text-lg font-medium">{kind === "expenses" ? "Vendor bills from Odoo" : "From Odoo"}</h3>
            <ol className="space-y-2.5 text-[15px]">
              {steps.map((t, k) => <li key={k} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-bg text-[12px] font-semibold text-brand-d">{k + 1}</span>{t}</li>)}
            </ol>
          </section>
          <section className="rounded-xl border border-line p-5" data-testid="get-template">
            <h3 className="mb-3 text-lg font-medium">No Odoo? Use our template</h3>
            <TemplateButton kind={kind === "sales" ? "sales" : kind === "expenses" ? "expenses" : "financials"} />
            <ul className="mt-3 space-y-1.5 text-[15px] text-mute"><li>Fill it in. Save it.</li><li>One number in each box.</li></ul>
          </section>
        </div>
        <p className="mt-3 text-[13px] text-mute">Only have a PDF? That works too.</p>
        <WizardNav onBack={setupStep ? undefined : () => setScreen("what")} next="Next: upload my file" onNext={() => setScreen("upload")} />
      </div>
    );
  }

  // 3 · Upload
  if (screen === "upload" || (!res && !salesRead && !expRead && screen !== "done")) {
    return (
      <div data-testid="wiz-upload">
        <WizardSteps at="upload" />
        <WizardTitle title="Upload your file" hint={kind === "sales" ? "Your sales file." : kind === "expenses" ? "Your vendor bills, or the expenses template." : "Your accounts file. You can add your Trial Balance too: it double-checks the numbers."} />
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files); if (fs.length) onFiles(fs); }}
          onClick={() => input.current?.click()}
          className="flex max-w-4xl cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand/50 bg-brand-bg/10 px-6 py-20 text-center transition hover:border-brand hover:bg-brand-bg/30"
          data-testid="dropzone"
        >
          {busy ? <Loader2 className="h-12 w-12 animate-spin text-brand" /> : <Upload className="h-12 w-12 text-brand" strokeWidth={1.5} />}
          <div className="mt-4 text-xl">{busy ? "Reading your file…" : "Drop your file here, or click to choose"}</div>
          <div className="mt-1 text-[14px] text-mute">Excel, CSV or PDF</div>
          <input ref={input} type="file" multiple accept=".xlsx,.xls,.csv,.txt,.tsv,.pdf,.jpg,.jpeg,.png" className="hidden" data-testid="file-input" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) onFiles(fs); e.target.value = ""; }} />
          {(err || ingestErr) && <p className="mt-5 max-w-xl whitespace-pre-line rounded bg-red-bg px-3 py-2 text-left text-sm text-red" role="alert" data-testid="upload-error" onClick={(e) => e.stopPropagation()}>{err || ingestErr}</p>}
          {(err || ingestErr) && diag && <button type="button" onClick={(e) => { e.stopPropagation(); downloadDiagnostic(diag); }} className="mt-2 text-xs text-mute underline" data-testid="download-diagnostic">Send this to support (download)</button>}
        </div>
        <WizardNav onBack={() => setScreen("get")} />
      </div>
    );
  }

  // 6 · Done
  if (screen === "done" && done) {
    return (
      <div data-testid="done-step">
        <WizardSteps at="done" />
        <div className="mb-6 flex items-center gap-4 rounded-xl bg-green-bg p-6 text-green-d">
          <CheckCircle2 className="h-12 w-12 shrink-0" />
          <div><div className="text-2xl font-medium">Saved!</div><div className="text-[15px]">{done.what}.</div></div>
        </div>
        {kind === "accounts" && <ImportReadiness />}
        <div className="flex flex-wrap gap-3">
          {kind === "sales"
            ? <a href={`${company.basePath}/sales`} className="rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="done-see">See my sales</a>
            : kind === "expenses"
              ? <a href={`${company.basePath}/expenses`} className="rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="done-see">See my expenses</a>
              : <a href={`${company.basePath}/summary`} className="rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="done-see">See my reports</a>}
          <button onClick={() => reset(kind === "accounts" ? "sales" : "accounts")} className="rounded-md border border-brand-d px-6 py-3 font-medium text-brand-d" data-testid="done-next">{kind === "accounts" ? "Upload sales next" : "Upload accounts next"}</button>
        </div>
      </div>
    );
  }

  const wrong = wrongKind && (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border-2 border-amber bg-amber/10 px-4 py-3 text-[15px]" data-testid="upload-notice">
      <span>This looks like {KIND_WORD[wrongKind]} file.</span>
      <button onClick={() => setKind(wrongKind)} className="rounded bg-ink px-3 py-1.5 text-sm text-white" data-testid="switch-kind">Switch to {wrongKind}</button>
    </div>
  );
  const fileLine = (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-[14px]">
      <FileSpreadsheet className="h-4 w-4 text-brand-d" />
      <span className="font-medium">{files.map((f) => f.name).join(" + ")}</span>
      <button onClick={() => { setGrids(null); setSalesGrids(null); setExpGrids(null); setFiles([]); setScreen("upload"); }} className="text-mute underline">Choose another file</button>
    </div>
  );
  const more = (children: React.ReactNode) => (
    <details className="group mt-5 rounded-lg border border-line" data-testid="more-options">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[14px] text-mute"><ChevronDown className="h-4 w-4 transition group-open:rotate-180" />More options</summary>
      <div className="space-y-4 border-t border-line px-4 py-3">{children}</div>
    </details>
  );

  // 4 · Check (expenses only)
  if (!res && expRead && !salesRead) {
    const ps = expensePeriods(expRead.lines);
    if (screen === "save") {
      return (
        <div data-testid="expenses-save">
          <WizardSteps at="save" />
          <WizardTitle title="Save your expenses" hint={`${expToSave.length.toLocaleString("en-US")} lines${ps.length ? `, ${monthsText(ps)}` : ""}.`} />
          {expOverlap.length > 0 ? (
            <Duplicates months={expOverlap} same={false} newMonths={ps.filter((p) => !expensesLoaded.includes(p))} chosen={expMode === null ? null : expMode === "add" ? "add" : "merge"}
              onAdd={() => setExpMode("add")} onReplace={() => setExpMode("replace")} />
          ) : <p className="text-[15px]">New months only. Nothing is replaced.</p>}
          {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
          <WizardNav onBack={() => setScreen("check")} next={saving ? "Saving…" : "Save expenses"} nextTestId="save-expenses"
            disabled={saving || !expToSave.length || (expOverlap.length > 0 && expMode === null)}
            hint={expOverlap.length > 0 && expMode === null ? "Choose one first." : !expToSave.length ? "Nothing new to save." : undefined}
            onNext={() => start(async () => {
              setErr(null);
              const out = await saveExpenses(companyId, "file", expToSave, files.map((f) => f.name).join(" + "), { layouts: expRead.layouts.map((l) => ({ sheet: l.sheet, lines: l.lines, total: l.total, taxIncluded: l.taxIncluded, flipped: l.flipped })), fixes: fixes(), mode: expMode ?? "new" });
              if (!out.ok) { setErr(out.error); return; }
              setDone({ what: `${expToSave.length.toLocaleString("en-US")} expense lines saved` }); setScreen("done"); router.refresh();
            })} />
        </div>
      );
    }
    const total = expRead.lines.reduce((a, l) => a + l.amount, 0);
    return (
      <div data-testid="expenses-only">
        <WizardSteps at="check" />
        <WizardTitle title="Check your expenses" hint={errorCount ? `${errorCount} problem${errorCount > 1 ? "s" : ""}. Fix ${errorCount > 1 ? "them" : "it"} on the right.` : "All good. Look, then press Next."} />
        {wrong}
        {fileLine}
        <div className="mb-4 grid max-w-3xl grid-cols-3 gap-3" data-testid="expenses-preview">
          <Stat label="Months" value={String(ps.length)} sub={ps.length ? monthsText(ps) : ""} />
          <Stat label="Total costs" value={money(total, currency)} testId="expenses-total" />
          <Stat label="Problems" value={String(errorCount)} tone={errorCount ? "bad" : "ok"} />
        </div>
        {box}
        {more(<ExpensesPreview read={expRead} currency={currency} overrides={expOv} onChange={setExpOv} />)}
        {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        {demo
          ? <WizardNav onBack={() => setScreen("upload")} next="Create a free account to save" href="/login?mode=signup" nextTestId="commit-import" />
          : <WizardNav onBack={() => setScreen("upload")} next="Next: save" onNext={() => { setExpMode(expOverlap.length ? null : "replace"); setScreen("save"); }} disabled={errorCount > 0 || !expRead.lines.length} nextTestId="expenses-next" hint={errorCount ? "Fix the problems first." : undefined} />}
      </div>
    );
  }

  // 4 · Check (sales only)
  if (!res && salesRead) {
    const ps = salesPeriods(salesRead.lines);
    if (screen === "save") {
      return (
        <div data-testid="sales-save">
          <WizardSteps at="save" />
          <WizardTitle title="Save your sales" hint={`${salesToSave.length.toLocaleString("en-US")} lines${ps.length ? `, ${monthsText(ps)}` : ""}.`} />
          {salesOverlap.length > 0 ? (
            <Duplicates months={salesOverlap} same={false} newMonths={ps.filter((p) => !salesLoaded.includes(p))} chosen={salesMode === null ? null : salesMode === "add" ? "add" : "merge"}
              onAdd={() => setSalesMode("add")} onReplace={() => setSalesMode("replace")} />
          ) : <p className="text-[15px]">New months only. Nothing is replaced.</p>}
          {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
          <WizardNav onBack={() => setScreen("check")} next={saving ? "Saving…" : "Save sales"} nextTestId="save-sales"
            disabled={saving || !salesToSave.length || (salesOverlap.length > 0 && salesMode === null)}
            hint={salesOverlap.length > 0 && salesMode === null ? "Choose one first." : !salesToSave.length ? "Nothing new to save." : undefined}
            onNext={() => start(async () => {
              setErr(null);
              const out = await saveSales(companyId, "file", salesToSave, files.map((f) => f.name).join(" + "), { layouts: salesRead.layouts.map((l) => ({ sheet: l.sheet, kind: l.kind, lines: l.lines, total: l.total, taxIncluded: l.taxIncluded })), fixes: fixes(), mode: salesMode ?? "new" });
              if (!out.ok) { setErr(out.error); return; }
              setDone({ what: `${salesToSave.length.toLocaleString("en-US")} sales lines saved` }); setScreen("done"); router.refresh();
            })} />
        </div>
      );
    }
    const total = salesRead.lines.reduce((a, l) => a + l.amount, 0);
    return (
      <div data-testid="sales-only">
        <WizardSteps at="check" />
        <WizardTitle title="Check your sales" hint={errorCount ? `${errorCount} problem${errorCount > 1 ? "s" : ""}. Fix ${errorCount > 1 ? "them" : "it"} on the right.` : "All good. Look, then press Next."} />
        {wrong}
        {fileLine}
        <div className="mb-4 grid max-w-3xl grid-cols-3 gap-3" data-testid="sales-preview">
          <Stat label="Months" value={String(ps.length)} sub={ps.length ? monthsText(ps) : ""} />
          <Stat label="Total sales" value={money(total, currency)} testId="sales-total" />
          <Stat label="Problems" value={String(errorCount)} tone={errorCount ? "bad" : "ok"} />
        </div>
        {box}
        {more(<SalesPreview read={salesRead} currency={currency} overrides={salesOv} onChange={setSalesOv} />)}
        {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        {demo
          ? <WizardNav onBack={() => setScreen("upload")} next="Create a free account to save" href="/login?mode=signup" nextTestId="commit-import" />
          : <WizardNav onBack={() => setScreen("upload")} next="Next: save" onNext={() => { setSalesMode(salesOverlap.length ? null : "replace"); setScreen("save"); }} disabled={errorCount > 0 || !salesRead.lines.length} nextTestId="sales-next" hint={errorCount ? "Fix the problems first." : undefined} />}
      </div>
    );
  }
  if (!res) return null;

  // 5 · Save (accounts)
  if (screen === "save" && preview) {
    const canImport = !blocking.length || (acceptOn && reason.trim().length >= 10);
    const needChoice = overlap.length > 0 && !modeChosen && !allSame;
    const nothingNew = mode === "add" && !newMonths.length;
    return (
      <div data-testid="timeline-step">
        <WizardSteps at="save" />
        <WizardTitle title="Save your data" hint={`This file has ${monthsText([...new Set([...res.slices.PL, ...res.slices.BS])].sort())}.`} />
        {overlap.length > 0 && (
          <Duplicates months={overlapMonths} same={allSame} newMonths={newMonths} chosen={modeChosen || allSame ? (mode === "add" ? "add" : mode === "merge" ? "merge" : null) : null}
            onAdd={() => choose("add")} onReplace={() => choose("merge")} onReplaceAll={() => choose("replace")} replaceAll={mode === "replace"} />
        )}
        {!overlap.length && <p className="text-[15px]" data-testid="all-new">All these months are new. Nothing is replaced.</p>}
        {blocking.length > 0 && (
          <div className="mt-4 rounded-lg border-2 border-red/50 p-4 text-[14px]" data-testid="accept-box">
            <p className="mb-2 font-medium">Something doesn&apos;t add up.</p>
            <CheckList checks={blocking} />
            <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={acceptOn} onChange={(e) => setAcceptOn(e.target.checked)} data-testid="accept-check" /> Save anyway</label>
            {acceptOn && <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="Why is it right? (at least 10 letters)" className="mt-2 w-full rounded border border-line px-2 py-1.5" data-testid="accept-reason" />}
          </div>
        )}
        <details className="group mt-5 rounded-lg border border-line" data-testid="month-by-month">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[14px] text-mute"><ChevronDown className="h-4 w-4 transition group-open:rotate-180" />See month by month</summary>
          <div className="space-y-4 border-t border-line px-4 py-3">
            <Timeline cells={preview.timeline} checks={preview.checks} />
            <OverwriteDiffs diffs={preview.diffs} currency={currency} />
            <CheckList checks={preview.checks.filter((c) => !blocking.includes(c))} />
          </div>
        </details>
        {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        <WizardNav onBack={() => setScreen("check")} next={saving ? "Saving…" : mode === "replace" && preview.hasData ? "Replace all and save" : "Save"} onNext={commit}
          disabled={saving || previewing || !canImport || needChoice || nothingNew} busy={previewing} nextTestId="commit-import"
          hint={needChoice ? "Choose one first." : nothingNew ? "Nothing new to add." : undefined} />
      </div>
    );
  }

  // 4 · Check (accounts)
  return (
    <div data-testid="review">
      <WizardSteps at="check" />
      <WizardTitle title="Check your data" hint={errorCount ? `${errorCount} problem${errorCount > 1 ? "s" : ""}. Fix ${errorCount > 1 ? "them" : "it"} on the right.` : "All good. Look, then press Next."} />
      {wrong}
      {fileLine}
      <div className="mb-4 grid max-w-3xl grid-cols-3 gap-3">
        <Stat label="Months" value={String(res.periods.length)} sub={res.periods.length ? monthsText(res.periods) : ""} />
        <Stat label="Balanced?" value={maxImb < 1 ? "Yes ✓" : "No"} sub={maxImb < 1 ? undefined : `out by ${money(maxImb, currency)}`} tone={maxImb < 1 ? "ok" : "bad"} testId="balanced" />
        <Stat label="Problems" value={String(errorCount)} tone={errorCount ? "bad" : "ok"} testId="problems" />
      </div>
      {box}
      {more(<>
        <FileReading layouts={res.layouts} overrides={overrides} onChange={(o) => { setOverrides(o); setPreview(null); }} />
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
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
        {salesRead && salesRead.lines.length > 0 && <p className="text-[13px]" data-testid="sales-alongside">Also in this upload: {salesRead.lines.length.toLocaleString("en-US")} sales lines. They are saved too.</p>}
        {res.lines.some((l) => l.entries?.length && l.cls === "revenue" && !l.excluded) && <p className="text-[13px] text-mute" data-testid="ledger-sales-note">Invoice lines on revenue accounts also become your sales.</p>}
        {res.lines.some((l) => l.entries?.length && l.cls && !l.excluded && isPL(l.cls) && l.cls !== "revenue") && <p className="text-[13px] text-mute" data-testid="ledger-expenses-note">Lines on cost accounts also become your expenses (who you pay).</p>}
        {expRead && expRead.lines.length > 0 && <p className="text-[13px]" data-testid="expenses-alongside">Also in this upload: {expRead.lines.length.toLocaleString("en-US")} expense lines. They are saved too.</p>}
        {fileChecks.length > 0 && <CheckList checks={fileChecks} />}
        {controlCount > 0 && !fileChecks.some((c) => c.id === "control_total") && <p className="flex items-center gap-2 text-[13px] text-green-d" data-testid="controls-ok"><CheckCircle2 className="h-4 w-4" />Matches the totals in the file ({controlCount} checked).</p>}
        {(res.issues.warnings.length > 0 || res.issues.flips.length > 0 || res.issues.notes.length > 0) && (
          <div className="space-y-1.5 text-[13px]">
            {res.issues.warnings.map((w) => <div key={w} className="flex gap-2 rounded bg-amber/15 px-3 py-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#9a6b00]" />{w}</div>)}
            {[...res.issues.flips, ...res.issues.notes].map((w) => <div key={w} className="flex gap-2 rounded bg-band px-3 py-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-d" />{w}</div>)}
          </div>
        )}
      </>)}
      {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      {demo
        ? <WizardNav onBack={() => setScreen("upload")} next="Create a free account to save" href="/login?mode=signup" nextTestId="commit-import" />
        : <WizardNav onBack={() => setScreen("upload")} next={previewing ? "Checking…" : "Next: save"} onNext={() => runPreview()} disabled={previewing || !res.periods.length || errorCount > 0} busy={previewing} nextTestId="continue-timeline" hint={errorCount ? "Fix the problems first." : undefined} />}
    </div>
  );
}

/** Months already loaded: add only the new months, or replace them with the file. */
function Duplicates({ months, same, newMonths, chosen, onAdd, onReplace, onReplaceAll, replaceAll }: { months: string[]; same: boolean; newMonths: string[]; chosen: "add" | "merge" | null; onAdd: () => void; onReplace: () => void; onReplaceAll?: () => void; replaceAll?: boolean }) {
  return (
    <div className="rounded-xl border-2 border-amber bg-amber/5 p-4" data-testid="duplicates">
      <p className="text-[16px]"><b>You already have {monthsText(months)}.</b> {same ? "This file has the same numbers for them." : "What should we do?"}</p>
      <div className="mt-3 grid max-w-3xl gap-3 sm:grid-cols-2">
        <ChoiceCard icon="➕" title="Add only new months" sub={newMonths.length ? `Adds ${monthsText(newMonths)}. Keeps what you have.` : "Nothing new in this file."} onClick={onAdd} selected={chosen === "add" && !replaceAll} testId="mode-add" />
        <ChoiceCard icon="🔁" title="Replace those months" sub="Use this file's numbers for them." onClick={onReplace} selected={chosen === "merge" && !replaceAll} testId="mode-merge" />
      </div>
      {onReplaceAll && <button onClick={onReplaceAll} className={cn("mt-3 text-[13px] underline", replaceAll ? "font-semibold text-red" : "text-mute")} data-testid="mode-replace">{replaceAll ? "Replacing ALL your data with this file" : "Or replace all my data with this file"}</button>}
    </div>
  );
}

/** "Jan – Mar 2026, May 2026": months grouped into runs. */
function monthsText(ps: string[]) {
  const s = [...new Set(ps)].sort();
  const runs: string[][] = [];
  for (const p of s) {
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && monthAfter(prev) === p) last.push(p); else runs.push([p]);
  }
  const txt = runs.map((r) => (r.length === 1 ? mlabel(r[0]) : `${mlabel(r[0])} – ${mlabel(r[r.length - 1])}`));
  return txt.length > 3 ? `${txt.slice(0, 3).join(", ")} and more` : txt.join(", ");
}
const monthAfter = (p: string) => { const [y, m] = p.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };

function Stat({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" | "warn"; testId?: string }) {
  return (
    <div className={cn("rounded-md border-t-[3px] bg-band px-3 py-2.5", tone === "bad" ? "border-red" : tone === "warn" ? "border-amber" : "border-green")} data-testid={testId}>
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
