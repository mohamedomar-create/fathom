// One status model for a company's setup and checks (Phase 3a). The Data steps, the health banner and the "next" action
// all read companyStatus, so the same company state never reads two ways on two screens.
//
// The steps follow the order an accountant closes the books: setup, opening balances, the books themselves (a General
// Ledger, Odoo, statements or a cash book), the Trial Balance (verification only), the sub-ledgers (each reconciled to
// its control account), then review.
import { mlabel } from "@/lib/engine";
import type { Check } from "./checks";
import { checkKey } from "./checks";
import { monthLabel, type Lang } from "@/lib/i18n";
import { dat } from "@/lib/i18n/areas/dat";

export type StepId = "setup" | "opening" | "ledger" | "tb" | "sales" | "stock" | "ageing" | "review";
/** pending: still being added up; unchecked: its figures couldn't be read just now (never "to do"). */
export type StepStatus = "todo" | "done" | "verified" | "issues" | "locked" | "unchecked" | "pending";
export interface DataStep {
  id: StepId; n: number; title: string; role: string; status: StepStatus; detail: string;
  /** The Odoo report to export (menu path), when the step takes a file. */
  file?: string;
  /** What the step is checked against. */
  verifies?: string;
  action: { label: string; href: string } | null;
}

/** Where the books come from. Statements and cash books are complete books without a General Ledger. */
export type BooksBasis = "ledger" | "odoo" | "statements" | "cash";
/** Blocking checks not accepted, and warnings (shown apart; they never fail the books). */
export interface OpenChecks { blocking: number; warnings: number }
export type ModuleState = "pending" | "failed";

export interface CompanyStatusInput {
  basePath: string;
  booksStart: string | null;
  opening: { asAt: string } | null;
  booksFromZero: boolean;
  /** The ledger loaded carries its own opening balances ("Initial Balance" rows or entries before the books start). */
  openingInLedger: boolean;
  books: { from: string; to: string; basis: BooksBasis } | null;
  /** null: the checks (or what was accepted) couldn't be read, so nothing can be said about them. */
  checks: OpenChecks | null;
  /** The last Trial Balance compared with the books (never saved as data once a ledger exists). */
  tb: { at: string; file: string; months: string[]; diffs: number } | null;
  /** Sales detail from a file; untied = months whose total differs from the books' revenue. */
  sales: { months: string[]; untied: string[] } | null;
  /** Stock checks against the stock accounts (months checked, months agreeing). */
  stock: { checked: number; ok: number } | null;
  ageing: { side: "receivable" | "payable"; asOf: string; status: "ok" | "off" | "no_books" }[];
  /** Sub-ledgers still being added up, or whose figures couldn't be read. */
  modules?: Partial<Record<"sales" | "stock" | "ageing", ModuleState>>;
}

export interface CompanyStatus {
  steps: DataStep[];
  /** The first step that needs the person (to do, or with issues); null when setup is complete. */
  next: DataStep | null;
  /** What the health banner shows: failing only on blocking checks; unknown when they couldn't be read. */
  health: "ok" | "failing" | "unknown";
  open: OpenChecks | null;
  basis: BooksBasis | null;
}

/** The one open-check count: blocking and warnings not accepted; information never counts. */
export function openChecks(checks: readonly Pick<Check, "id" | "period" | "statement" | "severity">[], accepted: Iterable<string>): OpenChecks {
  const ok = new Set(accepted);
  let blocking = 0, warnings = 0;
  for (const c of checks) {
    if (ok.has(checkKey(c))) continue;
    if (c.severity === "block") blocking++;
    else if (c.severity === "warn") warnings++;
  }
  return { blocking, warnings };
}

/** The steps' words in the chosen language (English when none is given). */
export function companyStatus(s: CompanyStatusInput, lang: Lang = "en"): CompanyStatus {
  const t = lang === "ar" ? dat.ar.st : dat.en.st;
  const ml = lang === "ar" ? (p: string) => monthLabel(p, "ar") : mlabel;
  const span = (a: string, b: string) => (a === b ? ml(a) : `${ml(a)} – ${ml(b)}`);
  const up = (step: string) => `${s.basePath}/data/upload?step=${step}`;
  const b = s.books;
  const basis = b?.basis ?? null;
  const ledgerBasis = basis === "ledger" || basis === "odoo";
  const blocking = s.checks?.blocking ?? 0;
  const warnings = s.checks?.warnings ?? 0;
  const locked = !b;
  const after = (st: DataStep): DataStep =>
    !locked ? st
      // Loaded before the books: kept and shown, but nothing to check it against yet.
      : st.status !== "todo" && st.id !== "review" ? { ...st, status: "done", detail: `${st.detail.replace(/\s*$/, "")} ${t.notCheckedYet}` }
      : { ...st, status: "locked", detail: t.afterLedger, action: null };
  const steps: DataStep[] = [];

  steps.push({ id: "setup", n: 1, title: t.setupTitle, role: t.setupRole, status: s.booksStart ? "done" : "todo",
    detail: s.booksStart ? t.booksStart(s.booksStart) : t.setupTodo,
    action: { label: s.booksStart ? t.check : t.setUp, href: `${s.basePath}/settings/profile` } });

  const openingDone = !!s.opening || s.booksFromZero || s.openingInLedger;
  steps.push({ id: "opening", n: 2, title: t.openingTitle, role: t.openingRole, status: openingDone ? "done" : "todo",
    detail: s.opening ? t.openingLoaded(s.opening.asAt) : s.booksFromZero ? t.fromZero : s.openingInLedger ? t.inLedger : t.openingTodo,
    file: t.openingFile,
    verifies: t.openingVerifies, action: { label: t.upload, href: up("opening") } });

  const checksLine = blocking ? t.checksLine(blocking) : "";
  const booksDetail = !b ? t.booksTodo
    : basis === "statements" ? t.booksStatements(span(b.from, b.to), checksLine || t.bsBalances)
    : basis === "cash" ? t.booksCash(span(b.from, b.to))
    : t.booksLedger(span(b.from, b.to), basis === "odoo", checksLine || t.rollsForward);
  steps.push({ id: "ledger", n: 3, title: b ? t.booksTitle[b.basis] : t.ledgerTitle, role: basis === "statements" ? t.roleStatements : basis === "cash" ? t.roleCash : t.roleLedger,
    status: !b ? "todo" : !s.checks ? "unchecked" : blocking ? "issues" : ledgerBasis ? "verified" : "done", detail: !b || s.checks ? booksDetail : t.ledgerUnread(span(b.from, b.to)),
    file: t.ledgerFile,
    verifies: t.ledgerVerifies, action: { label: b ? (ledgerBasis ? t.uploadNewer : t.uploadGl) : t.upload, href: up("financials") } });

  const tb = s.tb;
  steps.push(after({ id: "tb", n: 4, title: t.tbTitle, role: t.tbRole, status: !tb ? "todo" : tb.diffs ? "issues" : "verified",
    detail: !tb ? t.tbTodo : tb.diffs ? t.tbDiffs(tb.diffs, span(tb.months[0], tb.months[tb.months.length - 1])) : t.tbAgrees(span(tb.months[0], tb.months[tb.months.length - 1])),
    file: t.tbFile, verifies: ledgerBasis ? t.tbVerifiesLedger : t.tbVerifiesBooks, action: { label: tb ? t.checkAnother : t.check, href: up("tb") } }));

  const sl = s.sales;
  steps.push(after({ id: "sales", n: 5, title: t.salesTitle, role: t.salesRole, status: !sl || !sl.months.length ? "todo" : sl.untied.length ? "issues" : "verified",
    detail: !sl || !sl.months.length ? (ledgerBasis ? t.salesTodoLedger : t.salesTodoBooks) : sl.untied.length ? t.salesUntied(sl.untied.length, ledgerBasis, sl.untied.map(ml).join(", ")) : t.salesTied(span(sl.months[0], sl.months[sl.months.length - 1]), ledgerBasis),
    file: t.salesFile, verifies: ledgerBasis ? t.salesVerifiesLedger : t.salesVerifiesBooks, action: { label: t.upload, href: up("sales") } }));

  const st = s.stock;
  steps.push(after({ id: "stock", n: 6, title: t.stockTitle, role: t.stockRole, status: !st || !st.checked ? "todo" : st.ok < st.checked ? "issues" : "verified",
    detail: !st || !st.checked ? t.stockTodo : st.ok < st.checked ? t.stockOff(st.checked - st.ok, st.checked) : t.stockOk(st.checked),
    file: t.stockFile, verifies: t.stockVerifies, action: { label: t.upload, href: up("inventory") } }));

  const off = s.ageing.filter((a) => a.status === "off");
  steps.push(after({ id: "ageing", n: 7, title: t.ageTitle, role: t.ageRole, status: !s.ageing.length ? "todo" : off.length ? "issues" : "verified",
    detail: !s.ageing.length ? t.ageTodo : s.ageing.map((a) => t.ageLine(a.side, a.asOf, a.status)).join(t.ageSep) + t.ageEnd,
    file: t.ageFile, verifies: t.ageVerifies, action: { label: t.upload, href: up("payments") } }));

  const warnLine = warnings ? t.warnLine(warnings) : "";
  const basisWord = basis === "statements" ? t.basisStatements : basis === "cash" ? t.basisCash : "";
  steps.push(after({ id: "review", n: 8, title: t.reviewTitle, role: t.reviewRole, status: blocking ? "issues" : "verified",
    detail: blocking ? t.reviewIssues(blocking, warnLine) : t.reviewOk(warnLine, basisWord),
    action: { label: t.openChecks, href: `${s.basePath}/data/checks` } }));

  // Cash-basis books count money when it moves; sales lines are by invoice day and include credit sales, so the two are
  // not compared (a difference there is the basis, not an error).
  if (basis === "cash") {
    const x = steps.find((y) => y.id === "sales")!;
    if (x.status === "issues" || x.status === "verified") { x.status = "done"; x.detail = t.cashSales(span(sl!.months[0], sl!.months[sl!.months.length - 1])); }
  }
  // A sub-ledger that could not be read, or is still being added up, is unknown, not missing: no upload is suggested.
  for (const x of steps) {
    const m = s.modules?.[x.id as "sales" | "stock" | "ageing"];
    if (!m || x.status === "locked") continue;
    x.status = m === "pending" ? "pending" : "unchecked";
    x.detail = m === "pending" ? t.pending : t.unread;
    x.action = null;
  }
  const review = steps[steps.length - 1];
  if (!locked && !s.checks) { review.status = "unchecked"; review.detail = t.checksUnread; }
  // Ledger books are only proven once the Trial Balance is in; statements and cash books have nothing to prove them against.
  else if (!locked && ledgerBasis && !blocking && !tb) { review.status = "todo"; review.detail = t.addTb; }

  const required = new Set<StepId>(["setup", "opening", "ledger", "review"]);
  const next = steps.find((x) => x.status === "issues" || (x.status === "todo" && (required.has(x.id) || (x.id === "tb" && review.status === "todo")))) ?? null;
  return { steps, next, health: !s.checks ? "unknown" : blocking ? "failing" : "ok", open: s.checks, basis };
}

/** How a module's figures loaded, as far as the status model cares. empty: the module holds no records. */
export interface ModuleLoad { status: "ready" | "empty" | "pending" | "stale" | "failed"; empty: boolean }
/**
 * Which sub-ledger steps are unknown (unread) or still being added up (pending). Any stock summary error (a failed read,
 * a failed build, a database not yet updated) is unread, never "missing"; a rebuild with a previous copy shows that copy.
 * Stock is checked against the expenses' cost of sales, so it is unread when they are.
 */
export function moduleStates(x: { sales: ModuleLoad; expenses: ModuleLoad; payments: ModuleLoad; inventory: { error: string | null; pending: boolean; wire: unknown; failedAt?: string | null } }): { unread: ("sales" | "stock" | "ageing")[]; pending: ("sales" | "stock" | "ageing")[] } {
  const unread: ("sales" | "stock" | "ageing")[] = [], pending: ("sales" | "stock" | "ageing")[] = [];
  const of = (m: ModuleLoad, id: "sales" | "stock" | "ageing") => {
    if (m.status === "failed") unread.push(id);
    else if (m.status === "pending" && m.empty) pending.push(id);
  };
  of(x.sales, "sales");
  // A failed rebuild shows its last good copy on the stock pages, but the checks can't vouch for the latest records.
  if (x.inventory.error || x.inventory.failedAt || x.expenses.status === "failed") unread.push("stock");
  else if ((x.inventory.pending && !x.inventory.wire) || (x.expenses.status === "pending" && x.expenses.empty)) pending.push("stock");
  of(x.payments, "ageing");
  return { unread, pending };
}
