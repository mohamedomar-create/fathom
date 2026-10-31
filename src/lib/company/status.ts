// One status model for a company's setup and checks (Phase 3a). The Data steps, the health banner and the "next" action
// all read companyStatus, so the same company state never reads two ways on two screens.
//
// The steps follow the order an accountant closes the books: setup, opening balances, the books themselves (a General
// Ledger, Odoo, statements or a cash book), the Trial Balance (verification only), the sub-ledgers (each reconciled to
// its control account), then review.
import { mlabel } from "@/lib/engine";
import type { Check } from "./checks";
import { checkKey } from "./checks";

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

const span = (a: string, b: string) => (a === b ? mlabel(a) : `${mlabel(a)} – ${mlabel(b)}`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

const BOOKS_TITLE: Record<BooksBasis, string> = { ledger: "General Ledger", odoo: "General Ledger", statements: "Statements (no General Ledger)", cash: "Cash book (cash basis)" };

export function companyStatus(s: CompanyStatusInput): CompanyStatus {
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
      : st.status !== "todo" && st.id !== "review" ? { ...st, status: "done", detail: `${st.detail.replace(/\s*$/, "")} Not checked yet: load the General Ledger first.` }
      : { ...st, status: "locked", detail: "After the General Ledger: it is what this is checked against.", action: null };
  const steps: DataStep[] = [];

  steps.push({ id: "setup", n: 1, title: "Company and period", role: "Settings", status: s.booksStart ? "done" : "todo",
    detail: s.booksStart ? `Books start ${s.booksStart}.` : "Set the currency, financial year and the day your books start.",
    action: { label: s.booksStart ? "Check" : "Set up", href: `${s.basePath}/settings/profile` } });

  const openingDone = !!s.opening || s.booksFromZero || s.openingInLedger;
  steps.push({ id: "opening", n: 2, title: "Opening balances", role: "Record: the balance sheet the day before the books start", status: openingDone ? "done" : "todo",
    detail: s.opening ? `Loaded at ${s.opening.asAt}.` : s.booksFromZero ? "Your books start from zero." : s.openingInLedger ? "Carried by your General Ledger." : "Skip this if your General Ledger has opening balances, or your books start from zero.",
    file: "Accounting → Reporting → General Ledger or Trial Balance, for the day before your books start",
    verifies: "Debits equal credits; the balance sheet balances.", action: { label: "Upload", href: up("opening") } });

  const checksLine = blocking ? `${plural(blocking, "check")} to look at.` : "";
  const booksDetail = !b ? "The book of record. It also gives your sales and expense lines, stock postings and payments in and out."
    : basis === "statements" ? `${span(b.from, b.to)}, from your P&L and balance sheet. ${checksLine || "The balance sheet balances every month."} Without a General Ledger, sales and expense lines come from their own files.`
    : basis === "cash" ? `${span(b.from, b.to)}, built from your cash book: money in and out, month by month. Sales on credit are not in it until they are paid.`
    : `${span(b.from, b.to)}${basis === "odoo" ? " (Odoo live)" : ""}. ${checksLine || "Every account rolls forward and the balance sheet balances."} Sales, expenses, stock postings and payments come from it.`;
  steps.push({ id: "ledger", n: 3, title: b ? BOOKS_TITLE[b.basis] : "General Ledger", role: basis === "statements" ? "Record: your monthly statements" : basis === "cash" ? "Record: your cash book" : "Record: every account, every month",
    status: !b ? "todo" : blocking ? "issues" : ledgerBasis ? "verified" : "done", detail: booksDetail,
    file: "Accounting → Reporting → General Ledger, from your books start to today, with Initial Balance ticked → Export",
    verifies: "Opening plus entries equals closing for every account; the balance sheet balances every month.", action: { label: b ? (ledgerBasis ? "Upload a newer one" : "Upload a General Ledger") : "Upload", href: up("financials") } });

  const tb = s.tb;
  steps.push(after({ id: "tb", n: 4, title: "Trial Balance", role: "Verification only: never saved as data", status: !tb ? "todo" : tb.diffs ? "issues" : "verified",
    detail: !tb ? "Optional proof: every account in Odoo's Trial Balance is compared with your books." : tb.diffs ? `${plural(tb.diffs, "difference")} against the books (${span(tb.months[0], tb.months[tb.months.length - 1])}).` : `Agrees with the books, account by account (${span(tb.months[0], tb.months[tb.months.length - 1])}).`,
    file: "Accounting → Reporting → Trial Balance, same dates → Export", verifies: ledgerBasis ? "Your General Ledger, account by account, month by month." : "Your books, account by account, month by month.", action: { label: tb ? "Check another" : "Check", href: up("tb") } }));

  const booksWord = ledgerBasis ? "the ledger's" : "the books'";
  const sl = s.sales;
  steps.push(after({ id: "sales", n: 5, title: "Sales detail", role: "Sub-ledger: products, quantities, customers", status: !sl || !sl.months.length ? "todo" : sl.untied.length ? "issues" : "verified",
    detail: !sl || !sl.months.length ? (ledgerBasis ? "Optional: products and quantities. Your sales totals already come from the General Ledger." : "Optional: products, quantities and customers.") : sl.untied.length ? `${plural(sl.untied.length, "month")} differ from ${booksWord} revenue (${sl.untied.map(mlabel).join(", ")}).` : `${span(sl.months[0], sl.months[sl.months.length - 1])}; every month ties to ${booksWord} revenue.`,
    file: "Invoicing → Reporting → Invoice Analysis → list view → Export", verifies: ledgerBasis ? "Revenue in the General Ledger, month by month." : "Revenue in your books, month by month.", action: { label: "Upload", href: up("sales") } }));

  const st = s.stock;
  steps.push(after({ id: "stock", n: 6, title: "Stock", role: "Sub-ledger: stock value and movements", status: !st || !st.checked ? "todo" : st.ok < st.checked ? "issues" : "verified",
    detail: !st || !st.checked ? "Optional: stock value, movements and slow stock." : st.ok < st.checked ? `${st.checked - st.ok} of ${st.checked} month checks differ from the stock accounts.` : `All ${st.checked} month checks agree with the stock accounts.`,
    file: "Inventory → Reporting → Valuation, Moves History and Stock → Export (one or all three)", verifies: "Stock accounts and cost of sales in your books.", action: { label: "Upload", href: up("inventory") } }));

  const off = s.ageing.filter((a) => a.status === "off");
  steps.push(after({ id: "ageing", n: 7, title: "Receivables and payables", role: "Sub-ledger: open items by customer and supplier", status: !s.ageing.length ? "todo" : off.length ? "issues" : "verified",
    detail: !s.ageing.length ? "Optional: who owes what, and how old it is." : s.ageing.map((a) => `${a.side === "receivable" ? "Receivable" : "Payable"} at ${a.asOf}: ${a.status === "ok" ? "agrees with the books" : a.status === "off" ? "differs from the books" : "no books for that month yet"}`).join("; ") + ".",
    file: "Accounting → Reporting → Aged Receivable and Aged Payable, same date → Export", verifies: "The receivable and payable control accounts at that date.", action: { label: "Upload", href: up("payments") } }));

  const warnLine = warnings ? ` ${plural(warnings, "warning")} to read (they don't stop anything).` : "";
  const basisWord = basis === "statements" ? " Verified on a statement basis: your P&L and balance sheet agree; there is no ledger to prove them account by account." : basis === "cash" ? " Verified on a cash basis: the figures are your cash book's money in and out." : "";
  steps.push(after({ id: "review", n: 8, title: "Review", role: "Sign-off", status: blocking ? "issues" : "verified",
    detail: blocking ? `${plural(blocking, "check")} to look at or accept with a reason.${warnLine}` : `Everything loaded agrees.${warnLine}${basisWord}`,
    action: { label: "Open checks", href: `${s.basePath}/data/checks` } }));

  // A sub-ledger that could not be read, or is still being added up, is unknown, not missing: no upload is suggested.
  for (const x of steps) {
    const m = s.modules?.[x.id as "sales" | "stock" | "ageing"];
    if (!m || x.status === "locked") continue;
    x.status = m === "pending" ? "pending" : "unchecked";
    x.detail = m === "pending" ? "Still adding up your latest upload. This updates by itself in a minute." : "Couldn't be checked just now: its figures couldn't be read. Reload the page to try again.";
    x.action = null;
  }
  const review = steps[steps.length - 1];
  if (!locked && !s.checks) { review.status = "unchecked"; review.detail = "Couldn't be checked just now: the checks couldn't be read. Reload the page to try again."; }
  // Ledger books are only proven once the Trial Balance is in; statements and cash books have nothing to prove them against.
  else if (!locked && ledgerBasis && !blocking && !tb) { review.status = "todo"; review.detail = "Add the Trial Balance check to prove the books, then review."; }

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
export function moduleStates(x: { sales: ModuleLoad; expenses: ModuleLoad; payments: ModuleLoad; inventory: { error: string | null; pending: boolean; wire: unknown } }): { unread: ("sales" | "stock" | "ageing")[]; pending: ("sales" | "stock" | "ageing")[] } {
  const unread: ("sales" | "stock" | "ageing")[] = [], pending: ("sales" | "stock" | "ageing")[] = [];
  const of = (m: ModuleLoad, id: "sales" | "stock" | "ageing") => {
    if (m.status === "failed") unread.push(id);
    else if (m.status === "pending" && m.empty) pending.push(id);
  };
  of(x.sales, "sales");
  if (x.inventory.error || x.expenses.status === "failed") unread.push("stock");
  else if ((x.inventory.pending && !x.inventory.wire) || (x.expenses.status === "pending" && x.expenses.empty)) pending.push("stock");
  of(x.payments, "ageing");
  return { unread, pending };
}
