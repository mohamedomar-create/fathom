// The Data section's one sequence, in the order an accountant closes the books: setup, opening balances, the General
// Ledger (the book of record), the Trial Balance (verification only), the sub-ledgers (detail, each reconciled to its
// control account), then review. Each step's status comes from what is loaded and what its checks say.
import { mlabel } from "@/lib/engine";

export type StepId = "setup" | "opening" | "ledger" | "tb" | "sales" | "stock" | "ageing" | "review";
export type StepStatus = "todo" | "done" | "verified" | "issues" | "locked";
export interface DataStep {
  id: StepId; n: number; title: string; role: string; status: StepStatus; detail: string;
  /** The Odoo report to export (menu path), when the step takes a file. */
  file?: string;
  /** What the step is checked against. */
  verifies?: string;
  action: { label: string; href: string } | null;
}
export interface DataStatus {
  basePath: string;
  booksStart: string | null;
  opening: { asAt: string } | null;
  booksFromZero: boolean;
  /** The ledger loaded carries its own opening balances ("Initial Balance" rows or entries before the books start). */
  openingInLedger: boolean;
  /** The book of record: a General Ledger upload or the Odoo connection; issues = blocking checks still open. */
  ledger: { from: string; to: string; odoo: boolean; issues: number } | null;
  /** The last Trial Balance compared with the books (never saved as data once a ledger exists). */
  tb: { at: string; file: string; months: string[]; diffs: number } | null;
  /** Sales detail from Odoo's Invoice Analysis; untied = months whose total differs from the ledger's revenue. */
  sales: { months: string[]; untied: string[] } | null;
  /** Stock checks against the stock accounts (months checked, months agreeing). */
  stock: { checked: number; ok: number } | null;
  ageing: { side: "receivable" | "payable"; asOf: string; status: "ok" | "off" | "no_books" }[];
  /** Checks still open across everything loaded (accepted ones excluded). */
  openChecks: number;
}

const span = (a: string, b: string) => (a === b ? mlabel(a) : `${mlabel(a)} – ${mlabel(b)}`);

export function dataSteps(s: DataStatus): DataStep[] {
  const up = (step: string) => `${s.basePath}/data/upload?step=${step}`;
  const gl = s.ledger;
  const locked = !gl;
  const after = (st: Omit<DataStep, "status" | "action" | "detail"> & { status: StepStatus; detail: string; action: DataStep["action"] }): DataStep =>
    !locked ? st
      // Loaded before the ledger: kept and shown, but nothing to check it against yet.
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

  steps.push({ id: "ledger", n: 3, title: "General Ledger", role: "Record: every account, every month", status: !gl ? "todo" : gl.issues ? "issues" : "verified",
    detail: !gl ? "The book of record. It also gives your sales and expense lines, stock postings and payments in and out." : `${span(gl.from, gl.to)}${gl.odoo ? " (Odoo live)" : ""}. ${gl.issues ? `${gl.issues} check${gl.issues > 1 ? "s" : ""} to look at.` : "Every account rolls forward and the balance sheet balances."} Sales, expenses, stock postings and payments come from it.`,
    file: "Accounting → Reporting → General Ledger, from your books start to today, with Initial Balance ticked → Export",
    verifies: "Opening plus entries equals closing for every account; the balance sheet balances every month.", action: { label: gl ? "Upload a newer one" : "Upload", href: up("financials") } });

  const tb = s.tb;
  steps.push(after({ id: "tb", n: 4, title: "Trial Balance", role: "Verification only: never saved as data", status: !tb ? "todo" : tb.diffs ? "issues" : "verified",
    detail: !tb ? "Optional proof: every account in Odoo's Trial Balance is compared with your books." : tb.diffs ? `${tb.diffs} difference${tb.diffs > 1 ? "s" : ""} against the books (${span(tb.months[0], tb.months[tb.months.length - 1])}).` : `Agrees with the books, account by account (${span(tb.months[0], tb.months[tb.months.length - 1])}).`,
    file: "Accounting → Reporting → Trial Balance, same dates → Export", verifies: "Your General Ledger, account by account, month by month.", action: { label: tb ? "Check another" : "Check", href: up("tb") } }));

  const sl = s.sales;
  steps.push(after({ id: "sales", n: 5, title: "Sales detail", role: "Sub-ledger: products, quantities, customers", status: !sl || !sl.months.length ? "todo" : sl.untied.length ? "issues" : "verified",
    detail: !sl || !sl.months.length ? "Optional: products and quantities. Your sales totals already come from the General Ledger." : sl.untied.length ? `${sl.untied.length} month${sl.untied.length > 1 ? "s" : ""} differ from the ledger's revenue (${sl.untied.map(mlabel).join(", ")}).` : `${span(sl.months[0], sl.months[sl.months.length - 1])}; every month ties to the ledger's revenue.`,
    file: "Invoicing → Reporting → Invoice Analysis → list view → Export", verifies: "Revenue in the General Ledger, month by month.", action: { label: "Upload", href: up("sales") } }));

  const st = s.stock;
  steps.push(after({ id: "stock", n: 6, title: "Stock", role: "Sub-ledger: stock value and movements", status: !st || !st.checked ? "todo" : st.ok < st.checked ? "issues" : "verified",
    detail: !st || !st.checked ? "Optional: stock value, movements and slow stock." : st.ok < st.checked ? `${st.checked - st.ok} of ${st.checked} month checks differ from the stock accounts.` : `All ${st.checked} month checks agree with the stock accounts.`,
    file: "Inventory → Reporting → Valuation, Moves History and Stock → Export (one or all three)", verifies: "Stock accounts and cost of sales in the General Ledger.", action: { label: "Upload", href: up("inventory") } }));

  const off = s.ageing.filter((a) => a.status === "off");
  steps.push(after({ id: "ageing", n: 7, title: "Receivables and payables", role: "Sub-ledger: open items by customer and supplier", status: !s.ageing.length ? "todo" : off.length ? "issues" : "verified",
    detail: !s.ageing.length ? "Optional: who owes what, and how old it is." : s.ageing.map((a) => `${a.side === "receivable" ? "Receivable" : "Payable"} at ${a.asOf}: ${a.status === "ok" ? "agrees with the books" : a.status === "off" ? "differs from the books" : "no books for that month yet"}`).join("; ") + ".",
    file: "Accounting → Reporting → Aged Receivable and Aged Payable, same date → Export", verifies: "The receivable and payable control accounts at that date.", action: { label: "Upload", href: up("payments") } }));

  steps.push(after({ id: "review", n: 8, title: "Review", role: "Sign-off", status: s.openChecks ? "issues" : "verified",
    detail: s.openChecks ? `${s.openChecks} check${s.openChecks > 1 ? "s" : ""} to look at or accept with a reason.` : "Everything loaded agrees.",
    action: { label: "Open checks", href: `${s.basePath}/data/checks` } }));
  // The review is only "done" once the book of record and its proof are in.
  const review = steps[steps.length - 1];
  if (!locked && !s.openChecks && !tb) { review.status = "todo"; review.detail = "Add the Trial Balance check to prove the books, then review."; }
  return steps;
}
