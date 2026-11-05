"use client";
import { Preflight, WIZARD_HANDS_ON } from "@/components/preflight/preflight";
import { accountsCounted, PreflightSummary, RejectedDownload } from "@/components/preflight/summary";
import type { PreflightModule, PreflightRun } from "@/lib/preflight";
import { AlertTriangle, CheckCircle2, ChevronDown, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { initialWizard, wizardReducer } from "./wizard-state";
import { addMonths, mlabel, money, type ClassKey } from "@/lib/engine";
import { materialUnmapped, rememberKey, toAccountInputs, type IngestOptions } from "@/lib/ingest/pipeline";
import type { Grid, Overrides, RawLine } from "@/lib/ingest/extract";
import { fixRecords, type FixRecord } from "@/lib/ingest/trace";
import { expenseIssues, financialIssues, finalTrace, salesIssues, sortedFinancials } from "@/lib/ingest/sorted";
import { expensesCsv, financialsFill, salesCsv } from "@/lib/templates/fill";
import { RawSheets, ROLE, type RawSheetData } from "@/components/upload/raw-sheet";
import { SortedView, type Focus, type SortedViewProps } from "@/components/upload/sorted-view";
import { TwoBox } from "@/components/upload/two-box";
import { ChoiceCard, WizardNav, WizardSteps, WizardTitle, type Screen } from "@/components/upload/wizard-shell";
import { ImportReadiness } from "@/components/setup/import-readiness";
import { useCompany } from "@/lib/company/context";
import { balancesCheckOnly, keepForMode, ledgerClear } from "@/lib/company/add-mode";
import { ADMIN_ONLY } from "@/lib/company/accept";
import { FileReading, ReadAs } from "./file-reading";
import { normLabel } from "@/lib/ingest/parse";
import { deriveInWorker, ingestInWorker, putSheets, readForUpload } from "@/lib/imports/worker-client";
import { hasEntries, type IngestOutcome } from "@/lib/ingest/wizard-ingest";
import { commitImport, previewImport, type PreviewResult } from "@/app/company/[id]/settings/actions";
import { checkKey, runChecks, type Check } from "@/lib/company/checks";
import type { ImportMode } from "@/lib/company/import-plan";
import { CheckList, OverwriteDiffs, Timeline } from "./import-timeline";
import { cn } from "@/lib/cn";
import { isPL } from "@/lib/company/build";
import type { SalesOverride } from "@/lib/ingest/sales";
import { saveSales } from "@/lib/company/save-sales";
import { FIELD_LABEL, readSales, SalesPreview } from "./sales-preview";
import { salesPeriods } from "@/lib/ingest/sales";
import { expensePeriods, type ExpenseOverride } from "@/lib/ingest/expenses";
import { saveExpenses } from "@/lib/company/save-expenses";
import { saveExpensesAs, saveSalesAs, type SaveMode } from "@/lib/company/save-modes";
import { clearLedgerLines } from "@/app/company/[id]/settings/ledger-actions";
import { EXPENSE_FIELD_LABEL, ExpensesPreview, readExpenses } from "./expenses-preview";
import { isPdfLike } from "@/lib/ingest/pdf-client";
import { PdfRead, type PdfSummary } from "./pdf-read";
import { TemplateButton } from "@/components/setup/readiness-view";
import { guessRoles, IMPORTED, needsConfirm, type RoleGuess, type SheetRole } from "@/lib/ingest/roles";
import { cashAccounts, cashCostColumns, ownerNetFormula, readCashBook, type CashLayout, type CashOverride } from "@/lib/ingest/cashbook";
import { tieMessages, workbookTie } from "@/lib/ingest/workbook";
import { WorkbookTieout } from "@/components/upload/workbook-tieout";
import { SaveProgress } from "@/components/upload/save-progress";
import { TbVerify } from "@/components/data/tb-verify";
import { CashPL } from "@/components/upload/cash-pl";
import { readBankStatement, type BankLayout, type BankOverride } from "@/lib/ingest/bank";
import { bookIssues, sheetIssues } from "@/lib/ingest/sorted";
import { SheetRoles } from "@/components/upload/sheet-roles";
import type { SalesLine } from "@/lib/ingest/sales";
import type { ExpenseLine } from "@/lib/ingest/expenses";
import { saveStockLedger } from "@/lib/company/save-inventory";
import { savePayments } from "@/lib/company/save-payments";
import type { ChunkOptions } from "@/lib/chunks";
import { InventoryStep } from "./inventory-upload";
import { readInventorySheets } from "@/lib/ingest/inventory-sheets";
import { OdooImport } from "@/components/imports/odoo-import";
import { PaymentsUpload } from "@/components/payments/payments-upload";
import { fingerprintAccounts, fingerprintBills, fingerprintSales, layoutIssues, type SavedLayouts } from "@/lib/ingest/layout-profile";
import { saveLayouts } from "@/app/company/[id]/settings/layout-actions";
import { diagnostic, type Diagnostic } from "@/lib/ingest/diagnostic";
import { cutBooks, cutLines, cutoffMessage } from "@/lib/ingest/cutoff";
import { fmtDay } from "@/lib/ingest/odoo";
import { useT } from "@/lib/i18n/use-t";
import { WIZ_FIXED_AR } from "@/lib/i18n/areas/wiz";
import { refText } from "@/components/upload/sorted-view";
import { dayIn } from "./import-timeline";

const NO_RAW: RawLine[] = [];
/** One step of saving after the figures (sales, expense, stock or payment lines), in chunks with its progress. */
type PostStep = { what: string; run: (onProgress: (done: number, of: number) => void) => Promise<{ ok: true } | { ok: false; error: string }> };
type Kind = "opening" | "accounts" | "sales" | "expenses" | "inventory" | "payments";

const FILE_CHECKS = new Set<Check["id"]>(["control_total", "duplicate", "tb_zero", "account_rollforward", "cross_check", "future_dated", "partial_month"]);

/**
 * Upload, one step at a time: what you are uploading → where to get the file → upload → check (your file beside what
 * iReport reads, problems fixed one by one) → save (months already loaded: add only new ones, or replace them) → done.
 * salesLoaded / expensesLoaded: months that already have sales / expense lines from an uploaded file (to warn about duplicates).
 */
export function UploadWizard({ companyId, currency, fyStart, savedMapping, savedLayouts, demo = false, setupStep, salesLoaded = [], expensesLoaded = [], booksStart: savedStart = null, ledgerLoaded = false, dataVersion = 0 }: { companyId: string; dataVersion?: number; ledgerLoaded?: boolean; booksStart?: string | null; currency: string; fyStart: number; savedMapping: Record<string, string>; savedLayouts?: SavedLayouts; hasData?: boolean; demo?: boolean; setupStep?: "opening" | "financials" | "tb" | "sales" | "expenses" | "inventory" | "payments"; salesLoaded?: string[]; expensesLoaded?: string[] }) {
  const router = useRouter();
  const company = useCompany();
  const T = useT(), d = T.d.wiz, w = d.w;
  const mt = (ps: string[]) => monthsText(ps, T.ml, d.andMore);
  const fd = (day: string) => (T.lang === "en" ? fmtDay(day) : dayIn(T, day));
  // Card, screen, files, sheets read, preview, error and done message: one reducer, one transition per move (wizard-state.ts).
  const [nav, dispatch] = useReducer(wizardReducer<Kind, Grid, PreviewResult>, initialWizard<Kind, Grid, PreviewResult>(setupStep === "opening" ? "opening" : setupStep === "sales" ? "sales" : setupStep === "expenses" ? "expenses" : setupStep === "inventory" ? "inventory" : setupStep === "payments" ? "payments" : setupStep === "financials" || setupStep === "tb" ? "accounts" : null));
  const { kind, screen, done, files, grids: allGrids, preview, err } = nav;
  const { setScreen, setErr, setFiles, setAllGrids, setPreview, start: startCard } = useMemo(() => ({
    setScreen: (screen: Screen) => dispatch({ type: "go", screen }),
    setErr: (err: string | null) => dispatch({ type: "set", patch: { err } }),
    setFiles: (files: File[]) => dispatch({ type: "set", patch: { files } }),
    setAllGrids: (grids: Grid[] | null) => dispatch({ type: "set", patch: { grids } }),
    setPreview: (preview: PreviewResult | null) => dispatch({ type: "set", patch: { preview } }),
    start: (k: Kind | null) => dispatch({ type: "start", kind: k }),
  }), []);
  const [modeChosen, setModeChosen] = useState(false);
  const [salesMode, setSalesMode] = useState<SaveMode | null>(null);
  const [expMode, setExpMode] = useState<SaveMode | null>(null);
  const [checked, setChecked] = useState(false);
  // Saving in steps after the figures: what is being saved now, and a stopped save that can continue.
  const [saveProgress, setSaveProgress] = useState<{ what: string; done: number; of: number } | null>(null);
  const [post, setPost] = useState<{ steps: PostStep[]; at: number; doneMsg: string } | null>(null);
  /** The version this upload saved: the summary on the done screen waits until the page has reloaded to it. */
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  // The person chose, on purpose, to save a summary report as figures although the books come from a ledger.
  const [asFigures, setAsFigures] = useState(false);
  // Preflight: the upload as read, waiting for its check; the check's result once it is done (for the save screen).
  const [pf, setPf] = useState<{ files: File[]; grids: Grid[] } | null>(null);
  const [pfRun, setPfRun] = useState<PreflightRun | null>(null);
  const pfModule: PreflightModule = kind === "opening" ? "opening" : kind === "sales" ? "sales" : kind === "expenses" ? "expenses" : kind === "inventory" ? "stock" : kind === "payments" ? "payments" : "accounts";
  const pfLabel = w.label[kind ?? "accounts"] ?? w.label.accounts;
  // Every sheet of the upload, what each one is (iReport's guess, or the person's choice), and their confirmation.
  // The same sheets kept in the background worker (under this token), where every reading of them runs.
  const [sheetsToken, setSheetsToken] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<RoleGuess[]>([]);
  const [roles, setRoles] = useState<Record<string, SheetRole>>({});
  const [rolesOk, setRolesOk] = useState(false);
  // On the opening balances card every sheet is read as accounts (a plain list of balances looks like a summary).
  const roleOf = useCallback((sheet: string): SheetRole => (kind === "opening" ? "statement" : roles[sheet] ?? guesses.find((x) => x.sheet === sheet)?.role ?? "summary"), [roles, guesses, kind]);
  const sheetsAs = useCallback((r: SheetRole) => { const gs = (allGrids ?? []).filter((g) => roleOf(g.name) === r); return gs.length ? gs : null; }, [allGrids, roleOf]);
  const grids = useMemo(() => sheetsAs("statement"), [sheetsAs]);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [diag, setDiag] = useState<Diagnostic | null>(null);
  const [busy, setBusy] = useState(false);
  const [opts, setOpts] = useState<Omit<IngestOptions, "mapping">>({ fyStart, ytd: "auto", closeEarnings: "auto", plugEquity: false });
  // The books start: the person's choice ("" = none), else the company's, else the day after Odoo's opening entry.
  const [startChoice, setStartChoice] = useState<string | undefined>(undefined);
  // Opening balances upload: the month end the balances are at (the person's choice, else read from the file).
  const [asAtChoice, setAsAtChoice] = useState<string | undefined>(undefined);
  const [mapping, setMapping] = useState<Record<string, ClassKey | "">>(savedMapping as Record<string, ClassKey | "">);
  const [saving, start] = useTransition();
  const [mode, setMode] = useState<ImportMode>("merge");
  const [previewing, setPreviewing] = useState(false);
  const [acceptOn, setAcceptOn] = useState(false);
  const [reason, setReason] = useState("");
  const input = useRef<HTMLInputElement>(null);
  // Sales exports (invoice lines or a pivot) uploaded alongside, or instead of, the accounting files.
  const salesGrids = useMemo(() => sheetsAs("sales"), [sheetsAs]);
  const [salesOv, setSalesOv] = useState<Record<string, SalesOverride>>({});
  const salesFile = useMemo(() => (salesGrids ? readSales(salesGrids, salesOv) : null), [salesGrids, salesOv]);
  const salesCut = useMemo(() => cutRead(salesFile, opts.cutoff), [salesFile, opts.cutoff]);
  const salesRead = salesCut.read;
  // Purchases (vendor bills, the expenses template) uploaded alongside, or instead of, the accounting files.
  const expGrids = useMemo(() => sheetsAs("bills"), [sheetsAs]);
  const [expOv, setExpOv] = useState<Record<string, ExpenseOverride>>({});
  const expFile = useMemo(() => (expGrids ? readExpenses(expGrids, expOv) : null), [expGrids, expOv]);
  const expCut = useMemo(() => cutRead(expFile, opts.cutoff), [expFile, opts.cutoff]);
  const expRead = expCut.read;
  // Cash books and bank statements give both: money out (expenses) and money in (sales).
  const [cashOv, setCashOv] = useState<Record<string, CashOverride>>({});
  const [bankOv, setBankOv] = useState<Record<string, BankOverride>>({});
  // The owner's own rules for cash books: VAT (their "net = amount − VAT" formula anywhere in the workbook applies to
  // every tab) and which month an entry counts in (their month headings, unless they choose the dates).
  const [rules, setRules] = useState<{ vat: "auto" | "net" | "asWritten"; months: "heading" | "date" }>({ vat: "auto", months: "heading" });
  const cashGrids = useMemo(() => sheetsAs("cashbook"), [sheetsAs]);
  const ownerNet = useMemo(() => (cashGrids ?? []).map((g) => ownerNetFormula(g)).find(Boolean) ?? null, [cashGrids]);
  const cashRead = useMemo(() => readBooks<CashOverride, CashLayout>(cashGrids, Object.fromEntries((cashGrids ?? []).map((g) => [g.name, { ...cashOv[g.name], ownerNet: !!ownerNet, vat: rules.vat, months: rules.months }])), readCashBook), [cashGrids, cashOv, ownerNet, rules]);
  // Building Financials from the cash books: on unless the company already has accounts; each cost column's class.
  const [plOn, setPlOn] = useState<boolean | null>(null);
  const [plMap, setPlMap] = useState<Record<string, ClassKey>>({});
  const bankRead = useMemo(() => readBooks<BankOverride, BankLayout>(sheetsAs("bank"), bankOv, readBankStatement), [sheetsAs, bankOv]);
  // Cash-book and bank lines follow the same cut-off as every other file.
  const books = useMemo(() => cutBooks(cashRead, bankRead, opts.cutoff), [cashRead, bankRead, opts.cutoff]);
  const allSales = useMemo(() => [...(salesRead?.lines ?? []), ...books.cash.sales, ...books.bank.sales], [salesRead, books]);
  const allExp = useMemo(() => [...(expRead?.lines ?? []), ...books.cash.expenses, ...books.bank.expenses], [expRead, books]);
  const hasBooks = cashRead.layouts.length + bankRead.layouts.length > 0;
  const rolesNeed = !!allGrids && kind !== "opening" && needsConfirm(guesses, roles);
  // The workbook as a whole: the owner's own summary figures against what was read from every tab, and copied tabs.
  const tie = useMemo(() => cashRead.layouts.length ? workbookTie({
    grids: allGrids ?? [], layouts: cashRead.layouts, sales: allSales, expenses: allExp,
    summarySheets: new Set(guesses.filter((g) => ["cashbook", "summary", "notes"].includes(roleOf(g.sheet))).map((g) => g.sheet)),
    skipped: (sh, r) => !!(cashOv[sh]?.skipRows?.includes(r) || overrides[sh]?.skipRows?.includes(r)),
  }) : null, [cashRead, allGrids, allSales, allExp, guesses, roleOf, cashOv, overrides]);
  const rolesBlock = rolesNeed && !rolesOk;
  // PDFs and scanned images are read page by page and checked by the person before joining the spreadsheets.
  const [pdfJob, setPdfJob] = useState<{ files: File[]; sheets: Grid[] } | null>(null);
  const [pdfSummary, setPdfSummary] = useState<PdfSummary | null>(null);
  // The row or line the person is looking at in the two boxes.
  const [focus, setFocus] = useState<Focus | null>(null);
  const [picked, setPicked] = useState<SortedViewProps["picked"]>(null);
  // Inventory sheets (valuation, moves, stock on hand, products): read together, saved to Inventory only.
  const [rentalLoc, setRentalLoc] = useState<string | null>(company.inventorySettings?.rentalLocation ?? null);
  const invParts = useMemo(() => (allGrids ? readInventorySheets(allGrids, roleOf, rentalLoc, currency) : null), [allGrids, roleOf, rentalLoc, currency]);

  /**
   * Sheets from the files (spreadsheets, or tables read from PDF pages): iReport decides what each one is (accounts, a
   * sales or bills list, a cash book, a bank statement, a price list, a summary) and the person can change it.
   */
  const takeSheets = useCallback((fs: File[], gs: Grid[], token: string, hints: Record<string, SheetRole> = {}) => {
    // A list preflight recognised by its headings (a sales or bills list) is that list, however short it is.
    const gu = guessRoles(gs).map((g) => (hints[g.sheet] && hints[g.sheet] !== g.role ? { ...g, role: hints[g.sheet], sure: true, why: "Its headings are the ones this import reads." } : g));
    setAllGrids(gs); setSheetsToken(token); setGuesses(gu); setRoles({}); setRolesOk(false);
    setOverrides({}); setSalesOv({}); setExpOv({}); setCashOv({}); setBankOv({}); setPlOn(null); setPlMap({});
    // The reading panel's findings come with the first reading, from the worker.
    setDiag(diagnostic(fs, gs, { warnings: [], skippedCols: [] }));
    setFocus(null); setPicked(null); setScreen("check");
  }, [setAllGrids, setScreen]);

  // Several files are read as one upload: a General Ledger gives the months, a Trial Balance or P&L for the same period checks them.
  const onFiles = useCallback(async (fs: File[]) => {
    setErr(null); setBusy(true); setFiles(fs); setDiag(null); setPreview(null); setAllGrids(null); setPf(null); setPfRun(null); setSalesOv({}); setExpOv({}); setFocus(null); setPicked(null); setModeChosen(false); setSalesMode(null); setExpMode(null);
    try {
      if (!fs.length) throw new Error(w.chooseFile);
      if (fs.length > 6) throw new Error(w.upTo6);
      if (fs.reduce((a, f) => a + f.size, 0) > 40 * 1024 * 1024 || fs.some((f) => f.size > 25 * 1024 * 1024)) throw new Error(w.tooLarge);
      const pdfs = fs.filter(isPdfLike), sheets = fs.filter((f) => !isPdfLike(f));
      if (pdfs.length && demo) throw new Error(w.pdfDemo);
      let grids: Grid[] = [], token = "";
      if (sheets.length) {
        try { ({ grids, token } = await readForUpload(await Promise.all(sheets.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() }))))); }
        catch { throw new Error(w.notSheet(sheets.length > 1)); }
      }
      setPdfSummary(null);
      if (pdfs.length) { setAllGrids(null); setPdfJob({ files: pdfs, sheets: grids }); return; }
      void token;
      // Every spreadsheet is checked before it is read for the import (preflight): the cleaned copy goes on.
      setPf({ files: fs, grids });
    } catch (e) {
      console.error("upload read failed", e);
      setErr((e as Error).message || w.cantRead); setAllGrids(null);
    } finally { setBusy(false); }
  }, [demo, setAllGrids, setErr, setFiles, setPreview, w]);
  const pfReady = useCallback(async ({ run }: { run: PreflightRun }) => {
    const job = pf;
    if (!job) return;
    setPfRun(run); setPf(null);
    const hints = Object.fromEntries(run.final.sheets.filter((x) => x.role === "sales" || x.role === "bills").map((x) => [x.sheet, x.role as SheetRole]));
    // Sheets no import reads (price lists, summaries, notes) go on as they are: the sheet list names each one and why.
    const leftOut = new Set(run.report.sheets.filter((x) => x.issues.some((i) => i.code === "irrelevant")).map((x) => x.sheet));
    const gs = job.grids.flatMap((g) => (leftOut.has(g.name) ? [g] : run.cleaned.forImport.filter((c) => c.name === g.name)));
    try { takeSheets(job.files, gs, await putSheets(gs), hints); }
    catch (e) { setErr((e as Error).message || w.cantRead); }
  }, [pf, takeSheets, setErr, w]);
  async function pdfDone(pdfGrids: Grid[], summary: PdfSummary) {
    const job = pdfJob;
    setPdfJob(null); setPdfSummary(summary); setErr(null);
    try { setPf({ files, grids: [...(job?.sheets ?? []), ...pdfGrids] }); }
    catch (e) { setErr((e as Error).message || w.cantFigures); setAllGrids(null); }
  }

  // Re-read the workbook whenever the user corrects how a sheet or column is interpreted: in the background worker, so the
  // page never freezes on a large ledger; the latest correction wins.
  const [reading, setReading] = useState<{ token: string; asked: object; outcome: IngestOutcome } | null>(null);
  const sheetNames = useMemo(() => (grids ?? []).map((g) => g.name).join("\u0001"), [grids]);
  // A new object each time what is asked changes: the reading is current when it answers this very request.
  const asked = useMemo(() => ({}), [sheetNames, sheetsToken, overrides, opts, mapping, startChoice, savedStart, kind, asAtChoice]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sheetNames || !sheetsToken) return;
    let live = true;
    const done = (o: IngestOutcome) => { if (live) setReading({ token: sheetsToken, asked, outcome: o }); };
    ingestInWorker(sheetsToken, sheetNames.split("\u0001"), { kind: kind === "opening" ? "opening" : "accounts", overrides, opts, mapping, startChoice, savedStart, asAtChoice })
      .then(done, (e) => done({ res: null, err: (e as Error).message || w.cantAnalyse, raw: [], booksStart: null, extract: { warnings: [], skippedCols: [] } }));
    return () => { live = false; };
  }, [asked]); // eslint-disable-line react-hooks/exhaustive-deps
  // The last reading of these sheets (kept on screen while a correction is being re-read).
  const outcome = sheetNames && reading?.token === sheetsToken ? reading.outcome : null;
  const ingesting = !!sheetNames && !!sheetsToken && reading?.asked !== asked;
  const res = outcome?.res ?? null, ingestErr = outcome?.err ?? null, raw = outcome?.raw ?? NO_RAW, booksStart = outcome?.booksStart ?? null;

  // The cut-off: what the person chose, or else the last day anything in the file is dated.
  const cutoffDay = opts.cutoff ?? ([res?.lastDay, lastDayOf(salesFile?.lines), lastDayOf(expFile?.lines), lastDayOf([...cashRead.sales, ...cashRead.expenses, ...bankRead.sales, ...bankRead.expenses])].filter((d): d is string => !!d).sort().pop());
  const cutoffField = cutoffDay && (
    <label className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="cutoff">
      <span className="font-medium">{w.cutoff}</span>
      <input type="date" value={cutoffDay} onChange={(e) => { setOpts({ ...opts, cutoff: /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) ? e.target.value : undefined }); setPreview(null); }} className="rounded border border-line px-1.5 py-0.5" />
      <span className="text-mute">{w.cutoffHint}</span>
    </label>
  );
  // Shown when the file holds Odoo's opening entry, or the company has a books start: everything before it is the opening balance.
  const openingDay = res?.booksStart.day ?? null;
  const startField = res && (booksStart || openingDay || savedStart) && (
    <label className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="books-start">
      <span className="font-medium">{w.booksStart}</span>
      <input type="month" value={booksStart?.slice(0, 7) ?? ""} onChange={(e) => { setStartChoice(/^\d{4}-\d{2}$/.test(e.target.value) ? `${e.target.value}-01` : ""); setPreview(null); }} className="rounded border border-line px-1.5 py-0.5" />
      <span className="text-mute">
        {booksStart ? w.startSet(fd(booksStart), res.booksStart.entries ? res.booksStart.entries.toLocaleString("en-GB") : null) : w.notSet}
        {openingDay && !savedStart ? w.odooOpening(fd(openingDay)) : ""}
        {savedStart && booksStart !== savedStart ? w.companyStart(fd(savedStart)) : ""}
      </span>
    </label>
  );
  const asAtDay = kind === "opening" && booksStart ? dayBefore(booksStart) : null;
  const asAtField = asAtDay && (
    <label className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="opening-as-at">
      <span className="font-medium">{w.asAt}</span>
      <input type="month" value={asAtDay.slice(0, 7)} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { setAsAtChoice(monthEndOf(e.target.value)); setPreview(null); } }} className="rounded border border-line px-1.5 py-0.5" />
      <span className="text-mute">{w.asAtHint(fd(asAtDay), fd(booksStart!))}</span>
    </label>
  );
  const reset = (k: Kind | null) => startCard(k);
  const dateFields = kind === "opening" ? asAtField : <>{cutoffField}{startField}</>;
  // No opening balances loaded and none in this file: balances start from zero (allowed, and said plainly).
  const firstMonth = res?.openingFrom ?? null;
  const openingLoaded = !!firstMonth && company.accounts.some((a) => !isPL(a.cls) && a.amounts[addMonths(firstMonth, -1)] !== undefined);
  const zeroNotice = kind === "accounts" && firstMonth && !openingLoaded && (
    <p className="mb-4 flex max-w-4xl flex-wrap items-center gap-3 rounded-lg border border-amber bg-amber/10 px-4 py-3 text-[14px]" data-testid="zero-opening">
      {w.zero(T.ml(firstMonth))}
      <button onClick={() => reset("opening")} className="rounded bg-ink px-3 py-1 text-sm text-white" data-testid="upload-opening">{w.uploadOpening}</button>
    </p>
  );
  // The books come from a General Ledger and this file isn't one: a Trial Balance or statement is read as a check only.
  const ledgerFile = !!res?.layouts.some((l) => l.kind === "ledger");
  const verifyOnly = balancesCheckOnly({ kind, read: !!res, ledgerFile, asFigures, setupStep: setupStep ?? null, ledgerLoaded });
  const maxImb = res ? Math.max(0, ...Object.values(res.imbalance).map(Math.abs)) : 0;
  // Problems visible before the server preview: double counting, unbalanced debits/credits, totals that differ from the file.
  const fileChecks = useMemo(() => {
    if (!res) return [];
    const accts = toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) }));
    return runChecks({ accounts: accts, controls: res.controls, extra: res.checks, unit: res.unit }).filter((c) => FILE_CHECKS.has(c.id));
  }, [res]);
  const controlCount = res?.controls.length ?? 0;

  // ---- the two boxes: the file as uploaded (left) and iReport's sorted reading (right), with fixes made in the box.
  const [downloading, setDownloading] = useState(false);
  const [showFile, setShowFile] = useState(0);
  const sorted = useMemo(() => (res ? sortedFinancials(res, raw) : null), [res, raw]);
  // Each company's export layouts: a changed one stops until the person confirms how it was read.
  const [layoutOk, setLayoutOk] = useState<Set<string>>(new Set());
  const fingerprints = useMemo(() => [
    ...(res?.layouts ?? []).filter((l) => l.role !== "check" && l.lines > 0 && l.kind !== "none" && l.kind !== "skipped").map(fingerprintAccounts),
    ...(salesRead?.layouts ?? []).map(fingerprintSales), ...(expRead?.layouts ?? []).map(fingerprintBills),
  ], [res, salesRead, expRead]);
  useEffect(() => { if (done && !demo && fingerprints.length) void saveLayouts(companyId, fingerprints); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = useMemo(() => [
    ...(res ? financialIssues(res, fileChecks) : []), ...(salesRead ? salesIssues(salesRead.layouts) : []), ...(expRead ? expenseIssues(expRead.layouts) : []),
    ...([["sales", salesCut.late], ["expenses", expCut.late]] as const).filter(([, late]) => late.length && opts.cutoff).map(([k, late]) => ({ id: `cutoff:${k}`, severity: "check" as const, sheet: late[0].src?.sheet ?? "", message: cutoffMessage(late, opts.cutoff!), fix: "settings" as const })),
    ...(books.late.length && opts.cutoff ? [{ id: "cutoff:books", severity: "check" as const, sheet: "", message: cutoffMessage(books.late, opts.cutoff), fix: "settings" as const }] : []),
    ...bookIssues([...cashRead.layouts, ...bankRead.layouts]),
    ...[...cashRead.failed.map((n) => ({ n, cash: true })), ...bankRead.failed.map((n) => ({ n, cash: false }))].map(({ n, cash }) => ({ id: `role:${n}`, severity: "check" as const, sheet: n, message: w.roleFail(n.split(" › ").pop() ?? n, cash), fix: "settings" as const })),
    ...sheetIssues(guesses, (sh) => IMPORTED.has(roleOf(sh))),
    ...(tie ? tieMessages(tie).map((m, i) => ({ id: `tie:${m.sheet}:${m.row ?? ""}:${m.col ?? ""}:${i}`, severity: m.severity, sheet: m.sheet, row: m.row, col: m.col, message: m.message, fix: (m.row !== undefined ? "cell" : "settings") as "cell" | "settings" })) : []),
    ...(demo ? [] : layoutIssues(fingerprints, savedLayouts ?? {}, layoutOk)),
  ], [res, fileChecks, salesRead, expRead, salesCut, expCut, books.late, opts.cutoff, cashRead, bankRead, guesses, roleOf, tie, demo, fingerprints, savedLayouts, layoutOk, w]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const fixAt = (sheet: string, f: (o: { cells?: Record<string, number | string | null>; skipRows?: number[] }) => { cells?: Record<string, number | string | null>; skipRows?: number[] }) => {
    setPreview(null);
    const r = roleOf(sheet);
    if (r === "sales") setSalesOv((o) => ({ ...o, [sheet]: { ...o[sheet], ...f(o[sheet] ?? {}) } }));
    else if (r === "bills") setExpOv((o) => ({ ...o, [sheet]: { ...o[sheet], ...f(o[sheet] ?? {}) } }));
    else if (r === "cashbook") setCashOv((o) => ({ ...o, [sheet]: { ...o[sheet], ...f(o[sheet] ?? {}) } }));
    else if (r === "bank") setBankOv((o) => ({ ...o, [sheet]: { ...o[sheet], ...f(o[sheet] ?? {}) } }));
    else setOverrides((o) => ({ ...o, [sheet]: { ...o[sheet], ...f(o[sheet] ?? {}) } }));
  };
  const onCell = (sheet: string, row: number, col: number, value: number | string | null) => fixAt(sheet, (o) => ({ cells: { ...o.cells, [`${row}:${col}`]: value } }));
  const onSkipRow = (sheet: string, row: number) => fixAt(sheet, (o) => ({ skipRows: [...new Set([...(o.skipRows ?? []), row])] }));
  // A choice applies to every line of the same account name; a coded account is remembered by its code (renames keep it).
  const onClass = (key: string, cls: ClassKey | "") => {
    const l = res?.lines.find((x) => x.key === key);
    if (!l) return;
    const same = (res?.lines ?? []).filter((x) => normLabel(x.label) === normLabel(l.label));
    setMapping((m) => ({ ...m, [normLabel(l.label)]: cls, ...Object.fromEntries(same.filter((x) => x.code.trim()).map((x) => [rememberKey(x), cls])) }));
  };
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
      for (const c of l.columns) { if (c.period) heads[c.col] = c.period; else if (c.field) heads[c.col] = T.lang === "en" ? FIELD_LABEL[c.field] : d.salesField[c.field] ?? FIELD_LABEL[c.field]; }
      out.push({ name: l.sheet, rows: g.rows, origin: g.origin, trace: l.trace, errors: l.errors, heads });
    }
    for (const l of cashRead.layouts) {
      const g = allGrids?.find((x) => x.name === l.sheet);
      if (!g) continue;
      const heads: Record<number, string> = {};
      for (const b of l.blocks) {
        heads[b.label] = b.dir === "out" ? w.head.paidFor : w.head.from;
        if (b.date !== null) heads[b.date] = w.head.date;
        if (b.vat !== null) heads[b.vat] = w.head.vat;
        for (const a of b.amounts) heads[a.col] = b.dir === "out" ? w.head.out(a.header) : w.head.inAmount;
      }
      out.push({ name: l.sheet, rows: g.rows, origin: g.origin, trace: l.trace, errors: l.errors, heads });
    }
    for (const l of bankRead.layouts) {
      const g = allGrids?.find((x) => x.name === l.sheet);
      if (!g) continue;
      const c = l.cols, heads: Record<number, string> = { [c.date]: w.head.date, [c.desc]: w.head.desc, [c.balance]: w.head.balance };
      if (c.debit !== null) heads[c.debit] = w.head.moneyOut;
      if (c.credit !== null) heads[c.credit] = w.head.moneyIn;
      if (c.amount !== null) heads[c.amount] = w.head.amount;
      out.push({ name: l.sheet, rows: g.rows, origin: g.origin, trace: l.trace, errors: l.errors, heads });
    }
    for (const l of expRead?.layouts ?? []) {
      const g = expGrids?.find((x) => x.name === l.sheet);
      if (!g) continue;
      const heads: Record<number, string> = {};
      for (const c of l.columns) if (c.field) heads[c.col] = T.lang === "en" ? EXPENSE_FIELD_LABEL[c.field] : d.expField[c.field] ?? EXPENSE_FIELD_LABEL[c.field];
      out.push({ name: l.sheet, rows: g.rows, origin: g.origin, trace: l.trace, errors: l.errors, heads });
    }
    return out;
  }, [res, grids, salesRead, salesGrids, expRead, expGrids, cashRead, bankRead, allGrids, T, d, w]);
  /** A row clicked on the left: the line it became on the right, or why it was not used. */
  const onRow = (sheet: string, row: number) => {
    const s = rawSheets.find((x) => x.name === sheet);
    const t = s?.trace[row];
    const where = `${sheet.split(" › ").pop()}${T.lang === "en" ? "," : "،"} ${refText(d, row, undefined, s?.origin)}`;
    setFocus({ sheet, rows: [row] });
    if (!t) { setPicked({ note: w.empty(where) }); return; }
    const role = d.raw.role[t.role] ?? ROLE[t.role].label;
    const used = t.role === "account" || t.role === "entry" || t.role === "opening";
    setPicked({ key: t.ref, sheet, row, note: w.picked(where, role, t.note || null, used) });
  };
  const fixes = (): FixRecord[] => [
    ...Object.entries(overrides).flatMap(([sheet, o]) => fixRecords(sheet, grids?.find((g) => g.name === sheet)?.rows ?? [], o)),
    ...Object.entries(salesOv).flatMap(([sheet, o]) => fixRecords(sheet, salesGrids?.find((g) => g.name === sheet)?.rows ?? [], o)),
    ...Object.entries(expOv).flatMap(([sheet, o]) => fixRecords(sheet, expGrids?.find((g) => g.name === sheet)?.rows ?? [], o)),
    ...Object.entries({ ...cashOv, ...bankOv }).flatMap(([sheet, o]) => fixRecords(sheet, allGrids?.find((g) => g.name === sheet)?.rows ?? [], o)),
  ].slice(0, 500);
  /** The sorted reading as iReport's own template: the financials as a filled workbook, sales lines as the sales template (CSV). */
  async function download() {
    setDownloading(true); setErr(null);
    try {
      const save = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); Object.assign(document.createElement("a"), { href: url, download: name }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      if (sorted && (sorted.plPeriods.length || sorted.bsPeriods.length)) {
        const r = await fetch("/api/templates/financials", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currency: /^[A-Z]{3}$/.test(currency) ? currency : "EGP", fy: fyStart, ...financialsFill(sorted) }) });
        if (!r.ok) throw new Error(w.template);
        save(await r.blob(), "ireport-financials-filled.xlsx");
      }
      if (allSales.length) save(new Blob([salesCsv(allSales, currency)], { type: "text/csv;charset=utf-8" }), "ireport-sales-filled.csv");
      if (allExp.length) save(new Blob([expensesCsv(allExp, currency)], { type: "text/csv;charset=utf-8" }), "ireport-expenses-filled.csv");
    } catch (e) { setErr((e as Error).message); } finally { setDownloading(false); }
  }
  const box = (
    <TwoBox
      leftSub={w.leftSub(rawSheets.length)}
      rightTone={errorCount ? "bad" : "ok"} showFile={showFile}
      left={<RawSheets sheets={rawSheets} focus={focus} onRow={onRow} />}
      right={<SortedView onConfirmLayout={(k) => setLayoutOk((x) => new Set(x).add(k))} fin={sorted} sales={allSales.length || salesRead ? allSales : null} expenses={allExp.length || expRead ? allExp : null} issues={issues} currency={currency} origin={(sh) => rawSheets.find((x) => x.name === sh)?.origin}
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
      if (ls.length) extra.push({ id: "unmapped", severity: "block", statement: st, title: `${ls.length} account${ls.length > 1 ? "s are" : " is"} not mapped`, detail: `${ls.slice(0, 4).map((l) => `'${l.name}'`).join(", ")}${ls.length > 4 ? "…" : ""}. Choose a class for each, or exclude it if it is a total or not an account.` });
    }
    return { companyId, mode: m, slices: res.slices, accounts, extra, controls: res.controls, ranges: res.ranges, openingFrom: res.openingFrom, booksStart, opening: kind === "opening" && asAtDay ? { asAt: asAtDay } : null, unit: (res.unit === 1000 || res.unit === 1_000_000 ? res.unit : 1) as 1 | 1000 | 1_000_000 };
  }

  async function runPreview(m: ImportMode = mode) {
    const p = payload(m);
    if (!p) { setErr(w.nothingToImport); return; }
    setErr(null); setPreviewing(true);
    try {
      const out = await previewImport(p);
      if (!out.ok) { setErr(out.error); return; }
      dispatch({ type: "preview", preview: out.data }); setAcceptOn(false);
      // The file repeats loaded months with the very same figures: adding only the new months is the safe default.
      if (kind !== "opening" && !modeChosen && m === "merge" && out.data.overlap.length && out.data.overlap.every((o) => o.same)) { setMode("add"); setModeChosen(true); void runPreview("add"); }
    } catch (e) {
      console.error("preview failed", e);
      setErr(w.previewFail((e as Error).message || w.network));
    } finally { setPreviewing(false); }
  }

  const blocking = preview?.checks.filter((c) => c.severity === "block" && !c.accepted && !c.existing) ?? [];
  // Failures that mean the books themselves do not add up: only an admin may accept them (the server checks it too).
  const adminOnly = blocking.filter((c) => ADMIN_ONLY.has(c.id));

  // The steps after the figures are saved, run in order with their progress; a stopped step is continued from there.
  async function runPost(steps: PostStep[], from: number, doneMsg: string) {
    for (let i = from; i < steps.length; i++) {
      setSaveProgress({ what: steps[i].what, done: 0, of: 0 });
      // A step that throws (a dropped connection) stops here like a refused one, so Continue can pick it up.
      const r = await steps[i].run((done, of) => setSaveProgress({ what: steps[i].what, done, of })).catch((e: unknown) => ({ ok: false as const, error: (e as Error)?.message || w.dropped }));
      if (!r.ok) {
        setSaveProgress(null);
        setPost({ steps, at: i, doneMsg });
        setErr(w.postStopped(steps[i].what, r.error));
        return;
      }
    }
    setSaveProgress(null);
    setPost(null);
    dispatch({ type: "saved", what: doneMsg });
    router.refresh();
  }
  const continuePost = () => { if (!post) return; setErr(null); start(() => runPost(post.steps, post.at, post.doneMsg)); };

  async function commit() {
    const p = payload(mode);
    if (!res || !files.length || !p) return;
    if (mode === "replace" && preview?.hasData && !confirm(w.replaceConfirm)) return;
    setErr(null);
    start(async () => {
      // The ledger's own lines (sales, expense, stock and payment lines) are worked out before anything is saved: if that
      // fails, nothing has changed and the screen says so.
      let derived: Awaited<ReturnType<typeof deriveInWorker>>;
      try {
        derived = sheetsToken && res.lines.some(hasEntries) ? await deriveInWorker(sheetsToken) : { sales: [], expenses: [], stock: [], payments: { lines: [], errors: [] }, vat: null };
      } catch (e) {
        console.error("derive failed", e);
        setErr(w.deriveFail((e as Error).message || w.unknown));
        return;
      }
      let out: Awaited<ReturnType<typeof commitImport>>;
      try {
        out = await commitImport({
          ...p, filename: files.map((f) => f.name).join(" + ").slice(0, 300),
          report: { kind: res.kind, periods: res.periods, warnings: res.issues.warnings, notes: res.issues.notes, flips: res.issues.flips, ...(res.asOf ? { asOf: res.asOf } : {}), ...(cutoffDay ? { cutoff: cutoffDay } : {}), source: ledgerFile ? "ledger" as const : "summary" as const, ...(pdfSummary ? { pdf: pdfSummary } : {}), mapping: Object.fromEntries(Object.entries(mapping).filter(([k]) => !k.includes("|"))), fixes: fixes() },
          accept: blocking.length && acceptOn ? { keys: blocking.map(checkKey), reason } : undefined,
          vatMeasured: derived.vat ? { rate: derived.vat.rate, from: derived.vat.from, to: derived.vat.to } : null,
        });
      } catch (e) {
        console.error("import failed", e);
        setErr(w.saveFail((e as Error).message || w.network));
        return;
      }
      if (!out.ok) {
        setErr(out.error);
        // Checks that block only now (the data changed since the preview): load them so they can be accepted here.
        if ("blocking" in out && out.blocking?.length && preview) setPreview({ ...preview, checks: [...preview.checks.filter((c) => !out.blocking!.some((b) => checkKey(b) === checkKey(c))), ...out.blocking] });
        return;
      }
      setSavedVersion(out.version);
      // The figures are saved. What the ledger gives besides is saved as steps, each one a staged save that replaces its
      // months in one go at its end; a step that stops is continued from there and never leaves a month half done.
      const filename = files.map((f) => f.name).join(" + ");
      const addedPL = new Set(preview?.timeline.filter((t) => t.PL === "new").map((t) => t.period) ?? []);
      const replaceAll = mode === "replace";
      // Lines taken from an earlier ledger never outlive the months they came from: the months this import replaces lose
      // theirs, even when this file (a Trial Balance, a P&L) has no lines for them; months before the books start too.
      const touchedPL = preview?.timeline.filter((t) => t.PL === "new" || t.PL === "overwrite").map((t) => t.period) ?? [];
      const preStart = booksStart && !replaceAll ? (preview?.timeline ?? []).map((t) => t.period).filter((p) => p < booksStart.slice(0, 7)) : [];
      // "Update these months" keeps the detail: only a file with its own ledger lines (a General Ledger) replaces them.
      const ledgerMonths = [...new Set(res.lines.filter(hasEntries).flatMap((l) => (l.entries ?? []).map((e) => e.period)))];
      const { months } = ledgerClear(mode, { ledgerMonths, touchedPL, preStart });
      const clears = replaceAll || months.length > 0;
      const keep = <T extends { period: string }>(ls: T[]) => keepForMode(ls, mode, addedPL);
      const pay = derived.payments;
      const payLines = keep(pay.lines);
      const steps: PostStep[] = [];
      const ledgerOpts = (on: ChunkOptions["onProgress"]) => ({ all: replaceAll, months, onProgress: on });
      if (clears) steps.push({ what: w.step.clearStock, run: () => clearLedgerLines(companyId, replaceAll ? "all" : months, ["stock"]) });
      const salesLedger = keep(derived.sales), salesFile = keep(allSales);
      if (salesLedger.length || clears) steps.push({ what: w.step.salesLedger, run: (on) => saveSales(companyId, "ledger", salesLedger, filename, {}, ledgerOpts(on)) });
      if (salesFile.length) steps.push({ what: w.step.sales, run: (on) => saveSales(companyId, "file", salesFile, filename, {}, { onProgress: on }) });
      const expLedger = keep(derived.expenses), expFile = keep(allExp);
      if (expLedger.length || clears) steps.push({ what: w.step.expLedger, run: (on) => saveExpenses(companyId, "ledger", expLedger, filename, {}, ledgerOpts(on)) });
      if (expFile.length) steps.push({ what: w.step.exp, run: (on) => saveExpenses(companyId, "file", expFile, filename, {}, { onProgress: on }) });
      // The ledger's entries on the stock accounts: the accounts' side of the Inventory checks.
      const stockLines = keep(derived.stock);
      if (stockLines.length) steps.push({ what: w.step.stock, run: (on) => saveStockLedger(companyId, stockLines, filename, on) });
      // The ledger's bank and cash entries are the Payments in and out. They are saved only when every account's entries add
      // up to its movement; otherwise the reason is said, and the replaced months still lose their old ledger payments.
      let payNote = "";
      if (pay.errors.length) payNote = w.payNote(pay.errors[0], pay.errors.length - 1);
      const payNow = pay.errors.length ? [] : payLines;
      if (payNow.length || clears) steps.push({ what: pay.errors.length ? w.step.clearPay : w.step.pay, run: (on) => savePayments(companyId, "ledger", payNow, months, filename, on, { all: replaceAll }) });
      // Stock sheets in this upload are not saved here: they go through the Stock card, which checks every row.
      const stockNote = invParts && (invParts.layers.length || invParts.moves.length || invParts.onhand || invParts.products.length) ? w.stockNote : "";
      const saved = new Set([...(preview?.timeline ?? [])].filter((t) => t.PL === "new" || t.PL === "overwrite" || t.BS === "new" || t.BS === "overwrite").map((t) => t.period));
      await runPost(steps, 0, `${w.savedMonths(saved.size, payNow.length)}${payNote}${stockNote}${out.drift ? ` ${out.drift}` : ""}`);
    });
  }

  // ---- duplicates: months in the file that are already loaded
  const overlap = preview?.overlap ?? [];
  const overlapMonths = [...new Set(overlap.map((o) => o.period))].sort();
  const allSame = overlap.length > 0 && overlap.every((o) => o.same);
  const newMonths = res ? [...new Set([...res.slices.PL.filter((p) => !overlap.some((o) => o.statement === "PL" && o.period === p)), ...res.slices.BS.filter((p) => !overlap.some((o) => o.statement === "BS" && o.period === p))])].sort() : [];
  const choose = (m: ImportMode) => { setMode(m); setModeChosen(true); runPreview(m); };
  const salesOverlap = salesPeriods(allSales).filter((p) => salesLoaded.includes(p));
  const salesToSave = allSales.filter((l) => salesMode !== "new" || !salesLoaded.includes(l.period));
  const expOverlap = expensePeriods(allExp).filter((p) => expensesLoaded.includes(p));
  const expToSave = allExp.filter((l) => expMode !== "new" || !expensesLoaded.includes(l.period));
  // The file holds another kind of data than the one picked: say so, and offer to switch.
  const found: Record<Kind, boolean> = { opening: kind === "opening" && !!res, accounts: kind !== "opening" && !!res, sales: allSales.length > 0, expenses: allExp.length > 0, inventory: !!invParts, payments: false };
  const wrongKind: Kind | null = kind && !found[kind] ? (["accounts", "sales", "expenses", "inventory"] as Kind[]).find((k) => found[k]) ?? null : null;

  if (pdfJob) return <PdfRead companyId={companyId} files={pdfJob.files} onDone={pdfDone} onCancel={() => { setPdfJob(null); setFiles([]); }} />;

  // 1 · What are you uploading?
  if (screen === "what") {
    return (
      <div data-testid="wiz-what">
        <WizardSteps at="what" />
        <WizardTitle title={w.what} hint={w.pickOne} />
        <div className="grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ChoiceCard icon="📒" title={w.card.opening[0]} sub={w.card.opening[1]} onClick={() => startCard("opening")} testId="pick-opening" />
          <ChoiceCard icon="📊" title={w.card.accounts[0]} sub={w.card.accounts[1]} onClick={() => startCard("accounts")} testId="pick-accounts" />
          <ChoiceCard icon="🧾" title={w.card.sales[0]} sub={w.card.sales[1]} onClick={() => startCard("sales")} testId="pick-sales" />
          <ChoiceCard icon="💸" title={w.card.expenses[0]} sub={w.card.expenses[1]} onClick={() => startCard("expenses")} testId="pick-expenses" />
          <ChoiceCard icon="📦" title={w.card.inventory[0]} sub={w.card.inventory[1]} onClick={() => startCard("inventory")} testId="pick-inventory" />
          {!demo && <ChoiceCard icon="🤝" title={w.card.payments[0]} sub={w.card.payments[1]} onClick={() => startCard("payments")} testId="pick-payments" />}
        </div>
      </div>
    );
  }

  // 2 · Get your file
  if (screen === "get") {
    // "Another system or Excel" (the picker): the same files from any accounting program, or our template; no Odoo menus.
    const otherSystem = company.system === "other" && kind !== "inventory" && kind !== "payments";
    const otherSteps = w.other[kind === "opening" || kind === "sales" || kind === "expenses" ? kind : "accounts"];
    const getKey = kind === "opening" || kind === "payments" || kind === "inventory" || kind === "sales" || kind === "expenses" ? kind : setupStep === "tb" ? "tb" : "accounts";
    const steps = w.odoo[getKey];
    return (
      <div data-testid="wiz-get">
        <WizardSteps at="get" />
        <WizardTitle title={w.getTitle[getKey]} hint={kind === "inventory" ? w.getHintInv : setupStep === "tb" ? w.getHintTb : w.getHint} />
        {kind === "expenses" && (
          <p className="mb-4 flex max-w-4xl flex-wrap items-center gap-3 rounded-lg bg-green-bg px-4 py-3 text-[15px] text-green-d" data-testid="expenses-in-ledger">
            {w.inLedger}
            <button onClick={() => reset("accounts")} className="rounded bg-green-d px-3 py-1 text-sm text-white" data-testid="expenses-use-ledger">{w.useLedger}</button>
            <span className="text-[13px] text-ink/70">{w.billsMore}</span>
          </p>
        )}
        <div className="grid max-w-4xl gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-line p-5" data-testid={otherSystem ? "get-other" : "get-odoo"}>
            <h3 className="mb-3 text-lg font-medium">{otherSystem ? w.fromProgram : kind === "expenses" ? w.vendorBills : w.fromOdoo}</h3>
            <ol className="space-y-2.5 text-[15px]">
              {(otherSystem ? otherSteps : steps).map((t, k) => <li key={k} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-bg text-[12px] font-semibold text-brand-d">{k + 1}</span>{t}</li>)}
            </ol>
          </section>
          {kind === "inventory" ? (
            <section className="rounded-xl border border-line p-5" data-testid="get-inventory-why">
              <h3 className="mb-3 text-lg font-medium">{w.whyId}</h3>
              <ul className="space-y-1.5 text-[15px] text-mute">{w.whyIdItems.map((x) => <li key={x}>{x}</li>)}</ul>
            </section>
          ) : (
          <section className="rounded-xl border border-line p-5" data-testid="get-template">
            <h3 className="mb-3 text-lg font-medium">{otherSystem ? w.orTemplate : w.noOdoo}</h3>
            <TemplateButton kind={kind === "opening" ? "opening" : kind === "sales" ? "sales" : kind === "expenses" ? "expenses" : "financials"} />
            <ul className="mt-3 space-y-1.5 text-[15px] text-mute">{w.templateItems.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
          )}
        </div>
        <p className="mt-3 text-[13px] text-mute">{w.pdfToo}</p>
        <WizardNav onBack={setupStep ? undefined : () => setScreen("what")} next={w.nextUpload} onNext={() => setScreen("upload")} />
      </div>
    );
  }

  // 3 · Odoo Inventory exports: uploaded, read and saved as a background job (never read on this page's main thread).
  if (kind === "payments" && !demo) return <PaymentsUpload companyId={companyId} basePath={company.basePath} onBack={() => setScreen("get")} />;
  if (kind === "inventory" && !demo) return <OdooImport companyId={companyId} rentalLocation={company.inventorySettings?.rentalLocation ?? null} timeZone={company.timeZone ?? null} locationTypes={company.inventorySettings?.locationTypes} onBack={() => setScreen("get")} />;

  // 3 · Upload
  if (screen === "upload" || (!allGrids && screen !== "done")) {
    return (
      <div data-testid="wiz-upload">
        <WizardSteps at="upload" />
        {pf && (
          <div className="max-w-4xl">
            <WizardTitle title={w.checkFile} hint={w.checkFileHint} />
            <Preflight module={pfModule} moduleLabel={pfLabel} grids={pf.grids} fileName={pf.files.map((f) => f.name).join(" + ")} onReady={pfReady} stopOnLeftOut={false} allowNone handOn={WIZARD_HANDS_ON} />
            <WizardNav onBack={() => { setPf(null); setScreen("upload"); }} />
          </div>
        )}
        {!pf && <>
        <WizardTitle title={w.upload} hint={w.uploadHint[kind === "opening" || kind === "inventory" || kind === "sales" || kind === "expenses" ? kind : "accounts"]} />
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const fs = Array.from(e.dataTransfer.files); if (fs.length) onFiles(fs); }}
          onClick={() => input.current?.click()}
          className="flex max-w-4xl cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand/50 bg-brand-bg/10 px-6 py-20 text-center transition hover:border-brand hover:bg-brand-bg/30"
          data-testid="dropzone"
        >
          {busy ? <Loader2 className="h-12 w-12 animate-spin text-brand" /> : <Upload className="h-12 w-12 text-brand" strokeWidth={1.5} />}
          <div className="mt-4 text-xl">{busy ? w.readingFile : w.drop}</div>
          <div className="mt-1 text-[14px] text-mute">{w.types}</div>
          <input ref={input} type="file" multiple accept=".xlsx,.xls,.csv,.txt,.tsv,.pdf,.jpg,.jpeg,.png" className="hidden" data-testid="file-input" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) onFiles(fs); e.target.value = ""; }} />
          {(err || ingestErr) && <p className="mt-5 max-w-xl whitespace-pre-line rounded bg-red-bg px-3 py-2 text-start text-sm text-red" role="alert" data-testid="upload-error" onClick={(e) => e.stopPropagation()}>{err || ingestErr}</p>}
          {(err || ingestErr) && diag && <button type="button" onClick={(e) => { e.stopPropagation(); downloadDiagnostic(outcome ? { ...diag, warnings: [...diag.warnings, ...outcome.extract.warnings], skipped: [...diag.skipped, ...outcome.extract.skippedCols] } : diag); }} className="mt-2 text-xs text-mute underline" data-testid="download-diagnostic">{w.support}</button>}
        </div>
        <WizardNav onBack={() => setScreen("get")} />
        </>}
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
          <div><div className="text-2xl font-medium">{checked ? w.checked : w.saved}</div><div className="text-[15px]">{done.what.replace(/\.$/, "")}.</div></div>
        </div>
        {pfRun && pfRun.cleaned.rejected.length > 0 && <p className="mb-4 text-[14px]" data-testid="done-rejected">{w.rejected(pfRun.cleaned.rejected.length)}<RejectedDownload run={pfRun} label={w.rejectedDl} /></p>}
        {kind === "accounts" && !checked && <ImportReadiness waiting={savedVersion !== null && dataVersion < savedVersion} />}
        <div className="flex flex-wrap gap-3">
          {checked
            ? <a href={`${company.basePath}/data`} className="rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="done-see">{w.backSteps}</a>
            : kind === "inventory"
            ? <a href={`${company.basePath}/inventory`} className="rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="done-see">{w.seeStock}</a>
            : kind === "sales"
            ? <a href={`${company.basePath}/sales`} className="rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="done-see">{w.seeSales}</a>
            : kind === "expenses"
              ? <a href={`${company.basePath}/expenses`} className="rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="done-see">{w.seeExp}</a>
              : <a href={`${company.basePath}/summary`} className="rounded-md bg-brand-d px-6 py-3 font-medium text-white" data-testid="done-see">{w.seeReports}</a>}
          {!checked && <button onClick={() => reset(kind === "accounts" ? "sales" : "accounts")} className="rounded-md border border-brand-d px-6 py-3 font-medium text-brand-d" data-testid="done-next">{kind === "accounts" ? w.nextSales : kind === "opening" ? w.nextLedger : w.nextAccounts}</button>}
        </div>
      </div>
    );
  }

  const wrong = wrongKind && (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border-2 border-amber bg-amber/10 px-4 py-3 text-[15px]" data-testid="upload-notice">
      <span>{w.looksLike[wrongKind]}</span>
      <button onClick={() => dispatch({ type: "switch", kind: wrongKind })} className="rounded bg-ink px-3 py-1.5 text-sm text-white" data-testid="switch-kind">{w.switchTo[wrongKind]}</button>
    </div>
  );
  const fileLine = (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-[14px]">
      <FileSpreadsheet className="h-4 w-4 text-brand-d" />
      <span className="font-medium">{files.map((f) => f.name).join(" + ")}</span>
      <button onClick={() => dispatch({ type: "another" })} className="text-mute underline">{w.another}</button>
    </div>
  );
  const more = (children: React.ReactNode) => (
    <details className="group mt-5 rounded-lg border border-line" data-testid="more-options">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[14px] text-mute"><ChevronDown className="h-4 w-4 transition group-open:rotate-180" />{w.more}</summary>
      <div className="space-y-4 border-t border-line px-4 py-3">{children}</div>
    </details>
  );

  // What each sheet gives, in a few words, beside iReport's guess of what it is.
  const gives: Record<string, string> = {};
  for (const g of guesses) {
    const r = roleOf(g.sheet);
    const gv = w.gives, lines = gv.lines, comma = T.lang === "en" ? ", " : "، ";
    if (r === "statement") { const l = res?.layouts.find((x) => x.sheet === g.sheet); gives[g.sheet] = l ? (l.lines ? lines(l.lines, "account") : gv.nothing) : ""; }
    else if (r === "sales") { const l = salesRead?.layouts.find((x) => x.sheet === g.sheet); gives[g.sheet] = l ? `${lines(l.lines, "sales")}${comma}${money(l.total, currency)}` : gv.notSales; }
    else if (r === "bills") { const l = expRead?.layouts.find((x) => x.sheet === g.sheet); gives[g.sheet] = l ? `${lines(l.lines, "expense")}${comma}${money(l.total, currency)}` : gv.notBills; }
    else if (r === "cashbook") {
      const l = cashRead.layouts.find((x) => x.sheet === g.sheet);
      const direct = l?.controls.filter((c) => !c.derived) ?? [], bad = direct.filter((c) => !c.ok).length;
      gives[g.sheet] = l ? gv.cash(lines(l.out.lines, "cost"), money(l.out.total, currency), lines(l.in.lines, "sale"), money(l.in.total, currency), l.salesOn, direct.length ? (bad ? gv.totalsBad(bad, direct.length) : gv.totalsOk(direct.length)) : "") : gv.notCash;
    } else if (r === "bank") {
      const l = bankRead.layouts.find((x) => x.sheet === g.sheet);
      gives[g.sheet] = l ? gv.bank(lines(l.moneyOut.lines, "payment"), money(l.moneyOut.total, currency), lines(l.moneyIn.lines, "receipt"), money(l.moneyIn.total, currency), l.balanced) : gv.notBank;
    } else if (invParts?.sheets[g.sheet]) gives[g.sheet] = invParts.sheets[g.sheet];
    else gives[g.sheet] = r === "notes" ? gv.notes : gv.leftOut;
  }
  const rolesPanel = allGrids && (allGrids.length > 1 || rolesNeed) ? (
    <SheetRoles guesses={guesses} roles={roles} gives={gives} need={rolesNeed} confirmed={rolesOk}
      onRole={(sheet, r) => { setRoles((o) => ({ ...o, [sheet]: r })); setRolesOk(false); setPreview(null); }}
      onConfirm={() => setRolesOk(true)}
      bank={Object.fromEntries(Object.entries(bankOv).map(([k, o]) => [k, { out: !!o.outAsExpenses, in: !!o.inAsSales }]))}
      onBank={(sheet, k, on) => setBankOv((o) => ({ ...o, [sheet]: { ...o[sheet], [k === "out" ? "outAsExpenses" : "inAsSales"]: on } }))}
      cashSales={Object.fromEntries(Object.entries(cashOv).map(([k, o]) => [k, !o.salesOff]))}
      onCashSales={(sheet, on) => setCashOv((o) => ({ ...o, [sheet]: { ...o[sheet], salesOff: !on } }))} />
  ) : null;
  const rolesHint = rolesBlock ? w.confirmFirst : undefined;

  // A cash-basis P&L from the cash books (on unless the company already has accounts).
  const fromCashBook = company.accounts.some((a) => a.name === "Sales (cash book)");
  const plWanted = cashRead.layouts.length > 0 && !demo && (plOn ?? (company.accounts.length === 0 || fromCashBook));
  const plMonths = plWanted ? [...new Set([...books.cash.sales, ...books.cash.expenses].map((l) => l.period))].sort() : [];

  // 4 · Check (Inventory sheets only). Outside the demo they are saved only through the Stock card, which checks every row.
  if (!res && !hasBooks && !salesRead && !expRead && invParts && !demo) {
    return (
      <div className="rounded-xl border border-line bg-card p-6" data-testid="stock-elsewhere">
        {fileLine}
        <p className="text-[15px]">{w.stockElsewhere}</p>
        <button onClick={() => startCard("inventory")} className="mt-4 rounded bg-ink px-4 py-2 text-sm text-white" data-testid="go-stock">{w.goStock}</button>
      </div>
    );
  }
  if (!res && !hasBooks && !salesRead && !expRead && invParts) {
    return <InventoryStep parts={invParts} companyId={companyId} currency={currency} demo={demo} filename={files.map((f) => f.name).join(" + ")}
      rentalLocation={rentalLoc} onRental={setRentalLoc} rolesPanel={rolesPanel} fileLine={fileLine} rolesBlock={rolesBlock}
      onBack={() => setScreen("upload")} onDone={(what) => { dispatch({ type: "saved", what }); router.refresh(); }} />;
  }

  // 4 · Check (money in and out: cash books, bank statements, or a sales list with a bills list)
  if (!res && (hasBooks || (salesRead && expRead))) {
    const months = [...new Set([...salesPeriods(allSales), ...expensePeriods(allExp)])].sort();
    const overlapB = [...new Set([...salesOverlap, ...expOverlap])].sort();
    const toSave = salesToSave.length + expToSave.length;
    if (screen === "save") {
      return (
        <div data-testid="books-save">
          <WizardSteps at="save" />
          <PreflightSummary run={pfRun} company={company.name} moduleLabel={pfLabel} />
          <WizardTitle title={w.saveBooks} hint={w.saveBooksHint(expToSave.length.toLocaleString("en-US"), salesToSave.length.toLocaleString("en-US"), months.length ? mt(months) : "")} />
          <LineModes mt={mt} fileMonths={months} loaded={[...new Set([...salesLoaded, ...expensesLoaded])]} chosen={expMode} onChoose={(m) => { setExpMode(m); setSalesMode(m); }} />
          <ul className="mt-4 max-w-4xl space-y-1 text-[14px]" data-testid="books-save-summary">
            {cashRead.layouts.map((l) => <li key={l.sheet}><b className="font-medium">{l.sheet.split(" › ").pop()}</b>{w.costsSales(l.out.lines, money(l.out.total, currency), l.in.lines, money(l.in.total, currency))}</li>)}
            {bankRead.layouts.filter((l) => l.outAsExpenses || l.inAsSales).map((l) => <li key={l.sheet}><b className="font-medium">{l.sheet.split(" › ").pop()}</b>{w.bankLine(l.outAsExpenses ? l.moneyOut.lines : null, l.inAsSales ? l.moneyIn.lines : null)}</li>)}
            {plWanted && <li data-testid="books-save-pl"><b className="font-medium">{w.financials}</b>{w.cashPl(plMonths.length)}</li>}
          </ul>
          {saving && saveProgress && <SaveProgress what={saveProgress.what} done={saveProgress.done} of={saveProgress.of} />}
          {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
          <WizardNav onBack={() => setScreen("check")} next={saving ? w.saving : w.save} nextTestId="save-books"
            disabled={saving || !toSave || (overlapB.length > 0 && expMode === null)}
            hint={overlapB.length > 0 && expMode === null ? w.chooseFirst : !toSave ? w.nothingNew : undefined}
            onNext={() => start(async () => {
              setErr(null);
              const name = files.map((f) => f.name).join(" + ");
              const report = {
                roles: Object.fromEntries(guesses.map((g) => [g.sheet, roleOf(g.sheet)])),
                books: [
                  ...cashRead.layouts.map((l) => ({ sheet: l.sheet, kind: "cashbook", out: l.out, in: l.in, salesOn: l.salesOn, totals: l.controls.filter((c) => !c.derived).length })),
                  ...bankRead.layouts.map((l) => ({ sheet: l.sheet, kind: "bank", moneyOut: l.moneyOut, moneyIn: l.moneyIn, balanced: l.balanced, outAsExpenses: l.outAsExpenses, inAsSales: l.inAsSales })),
                ],
                fixes: fixes(),
              };
              // Financials first: if the P&L cannot be built, nothing is saved (no half upload).
              let plSaved = 0;
              if (plWanted) {
                const accounts = cashAccounts(books.cash.sales, books.cash.expenses, plMap);
                const periods = [...new Set(accounts.flatMap((a) => Object.keys(a.amounts)))].sort();
                // An entry that moved month since the last upload of this cash book (a December-dated payment now under
                // JANUARY) must not stay behind: the month either side is rewritten too when it holds only cash-book figures.
                const cashNames = new Set(["Sales (cash book)", ...cashCostColumns(books.cash.expenses).map((c) => c.name)]);
                const onlyCash = (p: string) => company.accounts.some((a) => a.amounts[p] && cashNames.has(a.name)) && company.accounts.every((a) => !a.amounts[p] || !isPL(a.cls) || cashNames.has(a.name));
                const edges = periods.length && expMode !== "new" ? [addMonths(periods[0], -1), addMonths(periods[periods.length - 1], 1)].filter((p) => !periods.includes(p) && onlyCash(p)) : [];
                const pl = await commitImport({
                  companyId, mode: expMode === "new" ? "add" : "merge", slices: { PL: [...periods, ...edges].sort(), BS: [] }, accounts, extra: [], controls: [], ranges: {}, openingFrom: null, filename: name.slice(0, 300),
                  report: { kind: "cashbook", periods, warnings: [], notes: ["Cash basis: the P&L is built from a cash book (money in and money out), not from accounts."], flips: [], mapping: Object.fromEntries(Object.entries(plMap)), fixes: report.fixes },
                });
                if (!pl.ok && !/Nothing new to add/.test(pl.error)) { setErr(w.plFail(pl.error, pl.blocking?.length ? pl.blocking.slice(0, 3).map((c) => c.title).join("; ") : "")); return; }
                if (pl.ok) plSaved = periods.length;
              }
              const e = await saveExpensesAs(companyId, expToSave, name, report, expMode ?? "changed", expensesLoaded, (done, of) => setSaveProgress({ what: w.step.exp, done, of }));
              if (!e.ok) { setErr(e.error); return; }
              const sv = await saveSalesAs(companyId, salesToSave, name, report, salesMode ?? "changed", salesLoaded, (done, of) => setSaveProgress({ what: w.step.sales, done, of }));
              if (!sv.ok) { setErr(w.salesFail(sv.error)); return; }
              if (plSaved) dispatch({ type: "switch", kind: "accounts" });
              dispatch({ type: "saved", what: `${e.summary} ${sv.summary}${plSaved ? w.andPl(plSaved) : ""}` });
              router.refresh();
            })} />
        </div>
      );
    }
    return (
      <div data-testid="books-only">
        <WizardSteps at="check" />
        <WizardTitle title={w.checkBooks} hint={errorCount ? w.problemsHint(errorCount) : rolesBlock ? w.checkRoles : w.allGood} />
        {fileLine}
        {dateFields}
        {rolesPanel}
        {cashRead.layouts.length > 0 && (
          <div className="mb-4 flex max-w-5xl flex-wrap gap-x-6 gap-y-2 text-[13px]" data-testid="book-rules">
            {cashRead.layouts.some((l) => l.blocks.some((b) => b.dir === "in" && b.vat !== null)) && (
              <label className="flex items-center gap-2">{w.vatRule}
                <select value={rules.vat} onChange={(e) => setRules((r) => ({ ...r, vat: e.target.value as typeof r.vat }))} className="rounded border border-line px-1.5 py-0.5" data-testid="rule-vat">
                  <option value="auto">{ownerNet ? w.vatFormula(ownerNet) : w.asFile}</option>
                  <option value="net">{w.lessVat}</option>
                  <option value="asWritten">{w.asWritten}</option>
                </select></label>
            )}
            <label className="flex items-center gap-2">{w.monthRule}
              <select value={rules.months} onChange={(e) => setRules((r) => ({ ...r, months: e.target.value as typeof r.months }))} className="rounded border border-line px-1.5 py-0.5" data-testid="rule-months">
                <option value="heading">{w.heading}</option>
                <option value="date">{w.ofDate}</option>
              </select></label>
          </div>
        )}
        {tie && <WorkbookTieout tie={tie} currency={currency} />}
        {cashRead.layouts.length > 0 && !demo && (
          <CashPL on={plWanted} onToggle={setPlOn} columns={cashCostColumns(books.cash.expenses)} map={plMap} onMap={(n, c) => setPlMap((m) => ({ ...m, [n]: c }))}
            revenue={books.cash.sales.reduce((a, l) => a + l.amount, 0)} hasAccounts={company.accounts.length > 0 && !fromCashBook} currency={currency} />
        )}
        <div className="mb-4 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4" data-testid="books-preview">
          <Stat label={w.months} value={String(months.length)} sub={months.length ? mt(months) : ""} />
          <Stat label={w.moneyOut} value={money(allExp.reduce((a, l) => a + l.amount, 0), currency)} testId="books-out" />
          <Stat label={w.moneyIn} value={money(allSales.reduce((a, l) => a + l.amount, 0), currency)} testId="books-in" />
          <Stat label={w.problems} value={String(errorCount)} tone={errorCount ? "bad" : "ok"} testId="books-problems" />
        </div>
        {box}
        {saving && saveProgress && <SaveProgress what={saveProgress.what} done={saveProgress.done} of={saveProgress.of} />}
          {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        {demo
          ? <WizardNav onBack={() => setScreen("upload")} next={w.signup} href="/login?mode=signup" nextTestId="commit-import" />
          : <WizardNav onBack={() => setScreen("upload")} next={w.nextSave} onNext={() => { const o = overlapB.length > 0; setExpMode(o ? null : "changed"); setSalesMode(o ? null : "changed"); setScreen("save"); }}
              disabled={errorCount > 0 || !(allSales.length + allExp.length) || rolesBlock} nextTestId="books-next" hint={errorCount ? w.fixFirst : rolesHint ?? (!(allSales.length + allExp.length) ? w.nothingSheets : undefined)} />}
      </div>
    );
  }

  // 4 · Check (expenses only)
  if (!res && expRead && !salesRead) {
    const ps = expensePeriods(expRead.lines);
    if (screen === "save") {
      return (
        <div data-testid="expenses-save">
          <WizardSteps at="save" />
          <PreflightSummary run={pfRun} company={company.name} moduleLabel={pfLabel} />
          <WizardTitle title={w.saveExp} hint={w.linesHint(expToSave.length.toLocaleString("en-US"), ps.length ? mt(ps) : "")} />
          <LineModes mt={mt} fileMonths={ps} loaded={expensesLoaded} chosen={expMode} onChoose={setExpMode} />
          {saving && saveProgress && <SaveProgress what={saveProgress.what} done={saveProgress.done} of={saveProgress.of} />}
          {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
          <WizardNav onBack={() => setScreen("check")} next={saving ? w.saving : w.saveExpBtn} nextTestId="save-expenses"
            disabled={saving || !expToSave.length || (expOverlap.length > 0 && expMode === null)}
            hint={expOverlap.length > 0 && expMode === null ? w.chooseFirst : !expToSave.length ? w.nothingNew : undefined}
            onNext={() => start(async () => {
              setErr(null);
              const out = await saveExpensesAs(companyId, expToSave, files.map((f) => f.name).join(" + "), { layouts: expRead.layouts.map((l) => ({ sheet: l.sheet, lines: l.lines, total: l.total, taxIncluded: l.taxIncluded, flipped: l.flipped })), fixes: fixes() }, expMode ?? "changed", expensesLoaded, (done, of) => setSaveProgress({ what: w.step.exp, done, of }));
              if (!out.ok) { setErr(out.error); return; }
              dispatch({ type: "saved", what: out.summary }); router.refresh();
            })} />
        </div>
      );
    }
    const total = expRead.lines.reduce((a, l) => a + l.amount, 0);
    return (
      <div data-testid="expenses-only">
        <WizardSteps at="check" />
        <WizardTitle title={w.checkExp} hint={errorCount ? w.problemsHint(errorCount) : w.allGood} />
        {wrong}
        {fileLine}
        {dateFields}
        {rolesPanel}
        <div className="mb-4 grid max-w-3xl grid-cols-3 gap-3" data-testid="expenses-preview">
          <Stat label={w.months} value={String(ps.length)} sub={ps.length ? mt(ps) : ""} />
          <Stat label={w.totalCosts} value={money(total, currency)} testId="expenses-total" />
          <Stat label={w.problems} value={String(errorCount)} tone={errorCount ? "bad" : "ok"} />
        </div>
        {box}
        {more(<ExpensesPreview read={expRead} currency={currency} overrides={expOv} onChange={setExpOv} />)}
        {saving && saveProgress && <SaveProgress what={saveProgress.what} done={saveProgress.done} of={saveProgress.of} />}
          {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        {demo
          ? <WizardNav onBack={() => setScreen("upload")} next={w.signup} href="/login?mode=signup" nextTestId="commit-import" />
          : <WizardNav onBack={() => setScreen("upload")} next={w.nextSave} onNext={() => { setExpMode(expOverlap.length ? null : "changed"); setScreen("save"); }} disabled={errorCount > 0 || !expRead.lines.length || rolesBlock || !!wrongKind} nextTestId="expenses-next" hint={wrongKind ? w.notThisCard(w.looksLike[wrongKind]) : errorCount ? w.fixFirst : rolesHint} />}
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
          <PreflightSummary run={pfRun} company={company.name} moduleLabel={pfLabel} />
          <WizardTitle title={w.saveSales} hint={w.linesHint(salesToSave.length.toLocaleString("en-US"), ps.length ? mt(ps) : "")} />
          <LineModes mt={mt} fileMonths={ps} loaded={salesLoaded} chosen={salesMode} onChoose={setSalesMode} />
          {saving && saveProgress && <SaveProgress what={saveProgress.what} done={saveProgress.done} of={saveProgress.of} />}
          {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
          <WizardNav onBack={() => setScreen("check")} next={saving ? w.saving : w.saveSalesBtn} nextTestId="save-sales"
            disabled={saving || !salesToSave.length || (salesOverlap.length > 0 && salesMode === null)}
            hint={salesOverlap.length > 0 && salesMode === null ? w.chooseFirst : !salesToSave.length ? w.nothingNew : undefined}
            onNext={() => start(async () => {
              setErr(null);
              const out = await saveSalesAs(companyId, salesToSave, files.map((f) => f.name).join(" + "), { layouts: salesRead.layouts.map((l) => ({ sheet: l.sheet, kind: l.kind, lines: l.lines, total: l.total, taxIncluded: l.taxIncluded })), fixes: fixes() }, salesMode ?? "changed", salesLoaded, (done, of) => setSaveProgress({ what: w.step.sales, done, of }));
              if (!out.ok) { setErr(out.error); return; }
              dispatch({ type: "saved", what: out.summary }); router.refresh();
            })} />
        </div>
      );
    }
    const total = salesRead.lines.reduce((a, l) => a + l.amount, 0);
    return (
      <div data-testid="sales-only">
        <WizardSteps at="check" />
        <WizardTitle title={w.checkSales} hint={errorCount ? w.problemsHint(errorCount) : w.allGood} />
        {wrong}
        {fileLine}
        {dateFields}
        {rolesPanel}
        <div className="mb-4 grid max-w-3xl grid-cols-3 gap-3" data-testid="sales-preview">
          <Stat label={w.months} value={String(ps.length)} sub={ps.length ? mt(ps) : ""} />
          <Stat label={w.totalSales} value={money(total, currency)} testId="sales-total" />
          <Stat label={w.problems} value={String(errorCount)} tone={errorCount ? "bad" : "ok"} />
        </div>
        {box}
        {more(<SalesPreview read={salesRead} currency={currency} overrides={salesOv} onChange={setSalesOv} />)}
        {saving && saveProgress && <SaveProgress what={saveProgress.what} done={saveProgress.done} of={saveProgress.of} />}
          {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        {demo
          ? <WizardNav onBack={() => setScreen("upload")} next={w.signup} href="/login?mode=signup" nextTestId="commit-import" />
          : <WizardNav onBack={() => setScreen("upload")} next={w.nextSave} onNext={() => { setSalesMode(salesOverlap.length ? null : "changed"); setScreen("save"); }} disabled={errorCount > 0 || !salesRead.lines.length || rolesBlock || !!wrongKind} nextTestId="sales-next" hint={wrongKind ? w.notThisCard(w.looksLike[wrongKind]) : errorCount ? w.fixFirst : rolesHint} />}
      </div>
    );
  }
  // Still reading (in the background worker): the page stays usable, and says so.
  if (!res && ingesting) {
    return (
      <div data-testid="reading">
        <WizardSteps at="check" />
        <WizardTitle title={w.readingFile} hint={w.readingHint} />
        <p className="flex items-center gap-2 text-[15px] text-mute"><Loader2 className="h-4 w-4 animate-spin" />{files.map((f) => f.name).join(" + ")}</p>
      </div>
    );
  }
  // Nothing in these sheets can be saved as they are: say why, sheet by sheet, and let the person change what they are.
  if (!res) {
    return (
      <div data-testid="nothing-to-save">
        <WizardSteps at="check" />
        <WizardTitle title={w.nothingYet} hint={w.nothingYetHint} />
        {fileLine}
        {rolesPanel ?? <p className="mb-4 text-[15px]">{guesses[0]?.why && (T.lang === "en" ? guesses[0].why : WIZ_FIXED_AR[guesses[0].why] ?? guesses[0].why)}</p>}
        {(ingestErr || issues.length > 0) && (
          <div className="max-w-5xl space-y-1.5 text-[13px]">
            {ingestErr && <div className="rounded bg-red-bg px-3 py-2 text-red">{ingestErr}</div>}
            {issues.slice(0, 12).map((i) => <div key={i.id} className="flex gap-2 rounded bg-amber/15 px-3 py-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#7d5600]" />{i.message}</div>)}
          </div>
        )}
        <p className="mt-4 max-w-3xl text-[14px] text-mute">{w.filesWork}</p>
        <WizardNav onBack={() => setScreen("upload")} />
      </div>
    );
  }

  // A Trial Balance, P&L or balance sheet when the books already come from a General Ledger: a check, never a second
  // copy of the figures (the ledger is the book of record).
  if (verifyOnly) {
    return <TbVerify companyId={companyId} fileName={files.map((f) => f.name).join(" + ") || "file"} file={toAccountInputs(res)} ranges={res.ranges} books={company.accounts} currency={currency} demo={demo}
      onBack={() => setScreen("upload")} onDone={(what) => { setChecked(true); dispatch({ type: "saved", what }); router.refresh(); }} onUseAsFigures={() => setAsFigures(true)} readAs={<ReadAs layouts={res.layouts} overrides={overrides} onChange={(o) => { setOverrides(o); setPreview(null); }} />} />;
  }

  // 5 · Save (accounts)
  if (screen === "save" && preview) {
    const canImport = !blocking.length || (acceptOn && reason.trim().length >= 10);
    const needChoice = kind !== "opening" && overlap.length > 0 && !modeChosen && !allSame;
    const nothingNew = mode === "add" && !newMonths.length;
    return (
      <div data-testid="timeline-step">
        <WizardSteps at="save" />
        <PreflightSummary run={pfRun} company={company.name} moduleLabel={pfLabel} counted={accountsCounted(res, d.sum.counted)} />
        <WizardTitle title={w.saveData} hint={w.fileHas(mt([...new Set([...res.slices.PL, ...res.slices.BS])].sort()))} />
        {kind === "opening" && <p className="text-[15px]" data-testid="opening-save-note">{w.openingNote}</p>}
        {kind !== "opening" && overlap.length > 0 && (
          <Duplicates mt={mt} months={overlapMonths} same={allSame} newMonths={newMonths} chosen={modeChosen || allSame ? (mode === "add" ? "add" : mode === "merge" ? "merge" : null) : null}
            onAdd={() => choose("add")} onReplace={() => choose("merge")} onReplaceAll={() => choose("replace")} replaceAll={mode === "replace"} />
        )}
        {kind !== "opening" && !overlap.length && <p className="text-[15px]" data-testid="all-new">{w.allNew}</p>}
        {blocking.length > 0 && (
          <div className="mt-4 rounded-lg border-2 border-red/50 p-4 text-[14px]" data-testid="accept-box">
            <p className="mb-2 font-medium">{w.notAddUp}</p>
            <CheckList checks={blocking} />
            {adminOnly.length > 0 && company.role !== "admin" && <p className="mt-3 text-red" data-testid="admin-only">{w.adminOnly(adminOnly.map((c) => (T.lang === "en" ? `"${c.title}"` : `«${c.title}»`)).join(", "))}</p>}
            <label className="mt-3 flex items-center gap-2"><input type="checkbox" checked={acceptOn} disabled={adminOnly.length > 0 && company.role !== "admin"} onChange={(e) => setAcceptOn(e.target.checked)} data-testid="accept-check" /> {w.saveAnyway}</label>
            {acceptOn && <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder={w.why} className="mt-2 w-full rounded border border-line px-2 py-1.5" data-testid="accept-reason" />}
          </div>
        )}
        {preview.closedSkipped?.length > 0 && <p className="mt-3 rounded bg-amber/10 px-3 py-2 text-sm" data-testid="closed-skipped">{preview.closedSkipped.length === 1 ? w.closedOne(T.ml(preview.closedSkipped[0])) : w.closedMany(preview.closedSkipped.length, preview.closedSkipped.map(T.ml).join(", "))}{w.closedRest(preview.closedSkipped.length === 1)}</p>}
        <details className="group mt-5 rounded-lg border border-line" data-testid="month-by-month">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-[14px] text-mute"><ChevronDown className="h-4 w-4 transition group-open:rotate-180" />{w.monthByMonth}</summary>
          <div className="space-y-4 border-t border-line px-4 py-3">
            <Timeline cells={preview.timeline} checks={preview.checks} />
            <OverwriteDiffs diffs={preview.diffs} currency={currency} />
            <CheckList checks={preview.checks.filter((c) => !blocking.includes(c))} />
          </div>
        </details>
        {saveProgress && <SaveProgress what={saveProgress.what} done={saveProgress.done} of={saveProgress.of} />}
        {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>}
        {post && !saving && <button onClick={continuePost} className="mt-3 rounded bg-brand-d px-5 py-2 text-sm font-medium text-white" data-testid="continue-save">{w.continueSave}</button>}
        {!post && <WizardNav onBack={() => setScreen("check")} next={saving ? w.saving : mode === "replace" && preview.hasData ? w.replaceAll : w.save} onNext={commit}
          disabled={saving || previewing || !canImport || needChoice || nothingNew} busy={previewing} nextTestId="commit-import"
          hint={needChoice ? w.chooseFirst : nothingNew ? w.nothingAdd : !canImport ? (acceptOn ? w.writeWhy : w.seeBox) : undefined} />}
      </div>
    );
  }

  // 4 · Check (accounts)
  return (
    <div data-testid="review">
      <WizardSteps at="check" />
      <WizardTitle title={w.checkData} hint={errorCount ? w.problemsHint(errorCount) : w.allGood} />
      {wrong}
      {fileLine}
      {zeroNotice}
      {rolesPanel}
      <div className="mb-4 grid max-w-3xl grid-cols-3 gap-3">
        {kind === "opening" ? <Stat label={w.bsAt} value={res.slices.BS[0] ? T.ml(res.slices.BS[0]) : "–"} sub={w.openingSub} /> : <Stat label={w.months} value={String(res.periods.length)} sub={res.periods.length ? mt(res.periods) : ""} />}
        <Stat label={w.balanced} value={maxImb < 1 ? w.yes : w.no} sub={maxImb < 1 ? undefined : w.outBy(money(maxImb, currency))} tone={maxImb < 1 ? "ok" : "bad"} testId="balanced" />
        <Stat label={w.problems} value={String(errorCount)} tone={errorCount ? "bad" : "ok"} testId="problems" />
      </div>
      {dateFields}
      <ReadAs layouts={res.layouts} overrides={overrides} onChange={(o) => { setOverrides(o); setPreview(null); }} />
      {box}
      {more(<>
        <FileReading layouts={res.layouts} overrides={overrides} onChange={(o) => { setOverrides(o); setPreview(null); }} />
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <label className="flex items-center gap-2">{w.ytd}
            <select value={opts.ytd} onChange={(e) => setOpts({ ...opts, ytd: e.target.value as IngestOptions["ytd"] })} className="rounded border border-line px-1.5 py-0.5">
              <option value="auto">{w.detect(!!res.detected.ytd)}</option><option value="yes">{w.yesOpt}</option><option value="no">{w.noOpt}</option>
            </select></label>
          <label className="flex items-center gap-2">{w.closeEarn}
            <select value={String(opts.closeEarnings)} onChange={(e) => setOpts({ ...opts, closeEarnings: e.target.value === "auto" ? "auto" : e.target.value === "true" })} className="rounded border border-line px-1.5 py-0.5">
              <option value="auto">{w.detect(!!res.detected.unclosedEarnings)}</option><option value="true">{w.yesOpt}</option><option value="false">{w.noOpt}</option>
            </select></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={opts.plugEquity} onChange={(e) => setOpts({ ...opts, plugEquity: e.target.checked })} /> {w.plug}</label>
        </div>
        {allSales.length > 0 && <p className="text-[13px]" data-testid="sales-alongside">{w.salesAlong(allSales.length.toLocaleString("en-US"))}</p>}
        {res.lines.some((l) => hasEntries(l) && l.cls === "revenue" && !l.excluded) && <p className="text-[13px] text-mute" data-testid="ledger-sales-note">{w.ledgerSales}</p>}
        {res.lines.some((l) => hasEntries(l) && l.cls && !l.excluded && isPL(l.cls) && l.cls !== "revenue") && <p className="text-[13px] text-mute" data-testid="ledger-expenses-note">{w.ledgerExp}</p>}
        {allExp.length > 0 && <p className="text-[13px]" data-testid="expenses-alongside">{w.expAlong(allExp.length.toLocaleString("en-US"))}</p>}
        {fileChecks.length > 0 && <CheckList checks={fileChecks} />}
        {controlCount > 0 && !fileChecks.some((c) => c.id === "control_total") && <p className="flex items-center gap-2 text-[13px] text-green-d" data-testid="controls-ok"><CheckCircle2 className="h-4 w-4" />{w.controlsOk(controlCount)}</p>}
        {(res.issues.warnings.length > 0 || res.issues.flips.length > 0 || res.issues.notes.length > 0) && (
          <div className="space-y-1.5 text-[13px]">
            {res.issues.warnings.map((w) => <div key={w} className="flex gap-2 rounded bg-amber/15 px-3 py-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#7d5600]" />{w}</div>)}
            {[...res.issues.flips, ...res.issues.notes].map((w) => <div key={w} className="flex gap-2 rounded bg-band px-3 py-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-d" />{w}</div>)}
          </div>
        )}
      </>)}
      {err && <p className="mt-4 rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      {demo
        ? <WizardNav onBack={() => setScreen("upload")} next={w.signup} href="/login?mode=signup" nextTestId="commit-import" />
        : <WizardNav onBack={() => setScreen("upload")} next={previewing ? w.checking : w.nextSave} onNext={() => runPreview()} disabled={previewing || ingesting || (!res.periods.length && !res.slices.BS.length) || errorCount > 0 || rolesBlock || !!wrongKind} busy={previewing || ingesting} nextTestId="continue-timeline" hint={wrongKind ? w.notThisCard(w.looksLike[wrongKind]) : errorCount ? w.fixFirstAt(issues.find((i) => i.severity === "error")?.message ?? "") : rolesHint} />}
    </div>
  );
}

/** Months already loaded: add only the new months, or replace them with the file. */
function Duplicates({ mt, months, same, newMonths, chosen, onAdd, onReplace, onReplaceAll, replaceAll }: { mt: (ps: string[]) => string; months: string[]; same: boolean; newMonths: string[]; chosen: "add" | "merge" | null; onAdd: () => void; onReplace: () => void; onReplaceAll?: () => void; replaceAll?: boolean }) {
  const w = useT().d.wiz.w;
  return (
    <div className="rounded-xl border-2 border-amber bg-amber/5 p-4" data-testid="duplicates">
      <p className="text-[16px]"><b>{w.youHave(mt(months))}</b> {same ? w.sameNumbers : w.whatDo}</p>
      <div className="mt-3 grid max-w-3xl gap-3 sm:grid-cols-2">
        <ChoiceCard icon="➕" title={w.addNew} sub={newMonths.length ? w.adds(mt(newMonths)) : w.nothingNewFile} onClick={onAdd} selected={chosen === "add" && !replaceAll} testId="mode-add" />
        <ChoiceCard icon="🔁" title={w.replaceThose} sub={w.useThis} onClick={onReplace} selected={chosen === "merge" && !replaceAll} testId="mode-merge" />
      </div>
      {onReplaceAll && <button onClick={onReplaceAll} className={cn("mt-3 text-[13px] underline", replaceAll ? "font-semibold text-red" : "text-mute")} data-testid="mode-replace">{replaceAll ? w.replacingAll : w.orReplaceAll}</button>}
    </div>
  );
}

/** How to save sales or expense lines when some months are already saved (spec R2.2): four ways, in plain words. */
function LineModes({ mt, fileMonths, loaded, chosen, onChoose }: { mt: (ps: string[]) => string; fileMonths: string[]; loaded: string[]; chosen: SaveMode | null; onChoose: (m: SaveMode) => void }) {
  const w = useT().d.wiz.w;
  if (!loaded.length) return <p className="text-[15px]">{w.newOnly}</p>;
  const overlap = fileMonths.filter((p) => loaded.includes(p)), fresh = fileMonths.filter((p) => !loaded.includes(p));
  return (
    <div className="rounded-xl border-2 border-amber bg-amber/5 p-4" data-testid="duplicates">
      <p className="text-[16px]">{overlap.length ? <><b>{w.youHave(mt(overlap))}</b>{w.howSave}</> : <><b>{w.haveSaved(mt(loaded))}</b>{w.otherMonths}</>}</p>
      <div className="mt-3 grid max-w-4xl gap-3 sm:grid-cols-2">
        <ChoiceCard icon="✳️" title={w.changed} sub={w.changedSub} onClick={() => onChoose("changed")} selected={chosen === "changed"} testId="mode-changed" />
        <ChoiceCard icon="➕" title={w.addNew} sub={fresh.length ? w.adds(mt(fresh)) : w.nothingNewFile} onClick={() => onChoose("new")} selected={chosen === "new"} testId="mode-add" />
        <ChoiceCard icon="🔁" title={w.replaceThese} sub={overlap.length ? w.useLinesFor(mt(overlap)) : w.useLines} onClick={() => onChoose("months")} selected={chosen === "months"} testId="mode-merge" />
        <ChoiceCard icon="♻️" title={w.replaceAllLines} sub={w.replaceAllSub} onClick={() => onChoose("all")} selected={chosen === "all"} testId="mode-all" />
      </div>
    </div>
  );
}

/** "Jan – Mar 2026, May 2026": months grouped into runs. */
function monthsText(ps: string[], ml: (p: string) => string = mlabel, more = "and more") {
  const s = [...new Set(ps)].sort();
  const runs: string[][] = [];
  for (const p of s) {
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && monthAfter(prev) === p) last.push(p); else runs.push([p]);
  }
  const txt = runs.map((r) => (r.length === 1 ? ml(r[0]) : `${ml(r[0])} – ${ml(r[r.length - 1])}`));
  return txt.length > 3 ? `${txt.slice(0, 3).join(", ")} ${more}` : txt.join(", ");
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


function downloadDiagnostic(d: Diagnostic) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `import-diagnostic-${d.file.replace(/[^\w.-]+/g, "_")}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Reads every cash book (or bank statement) with the person's corrections: its money out, money in, and layouts. */
const lastDayOf = (lines?: { day: string | null }[]) => lines?.reduce<string | undefined>((m, l) => (l.day && (!m || l.day > m) ? l.day : m), undefined);
/** A sales or expenses file with the lines after the cut-off set aside; each sheet's count and total follow. */
function cutRead<L extends SalesLine | ExpenseLine, Y extends { sheet: string; lines: number; total: number }>(r: { lines: L[]; layouts: Y[] } | null, cutoff: string | undefined) {
  if (!r || !cutoff) return { read: r, late: [] as L[] };
  const { kept, late } = cutLines(r.lines, cutoff);
  if (!late.length) return { read: r, late };
  const layouts = r.layouts.map((y) => { const out = late.filter((l) => l.src?.sheet === y.sheet); return { ...y, lines: y.lines - out.length, total: y.total - out.reduce((a, l) => a + l.amount, 0) }; });
  return { read: { ...r, lines: kept, layouts }, late };
}

function readBooks<O, L>(gs: Grid[] | null, ov: Record<string, O>, read: (g: Grid, o?: O) => { sales: SalesLine[]; expenses: ExpenseLine[]; layout: L } | null) {
  const out = { sales: [] as SalesLine[], expenses: [] as ExpenseLine[], layouts: [] as L[], failed: [] as string[] };
  for (const g of gs ?? []) {
    const r = read(g, ov[g.name]);
    if (!r) { out.failed.push(g.name); continue; }
    for (const x of r.sales) out.sales.push(x); for (const x of r.expenses) out.expenses.push(x); out.layouts.push(r.layout);
  }
  return out;
}

/** A month end ("2021-06-30") from a month ("2021-06"). */
function monthEndOf(month: string): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0));
  return d.toISOString().slice(0, 10);
}
const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
