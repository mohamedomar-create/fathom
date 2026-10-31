// The Data section's one sequence. The steps themselves come from the one status model (status.ts); this keeps the
// shape the Data page has always passed in.
import { companyStatus, type BooksBasis, type CompanyStatus, type DataStep, type ModuleState, type StepId, type StepStatus } from "./status";

export type { DataStep, StepId, StepStatus };
export interface DataStatus {
  basePath: string;
  booksStart: string | null;
  opening: { asAt: string } | null;
  booksFromZero: boolean;
  /** The ledger loaded carries its own opening balances ("Initial Balance" rows or entries before the books start). */
  openingInLedger: boolean;
  /** The book of record: a General Ledger upload or the Odoo connection; issues = blocking checks still open. */
  ledger: { from: string; to: string; odoo: boolean; issues: number } | null;
  /** Books without a General Ledger: monthly statements, or a cash book switched to the full system. */
  books?: { from: string; to: string; basis: Exclude<BooksBasis, "ledger" | "odoo"> } | null;
  /** The last Trial Balance compared with the books (never saved as data once a ledger exists). */
  tb: { at: string; file: string; months: string[]; diffs: number } | null;
  /** Sales detail from Odoo's Invoice Analysis; untied = months whose total differs from the ledger's revenue. */
  sales: { months: string[]; untied: string[] } | null;
  /** Stock checks against the stock accounts (months checked, months agreeing). */
  stock: { checked: number; ok: number } | null;
  ageing: { side: "receivable" | "payable"; asOf: string; status: "ok" | "off" | "no_books" }[];
  /** Blocking checks still open (accepted ones excluded); null when they couldn't be read. */
  openChecks: number | null;
  /** Warnings still open (shown apart; they never fail the books). */
  warnings?: number;
  /** Sub-ledger steps whose figures could not be read just now: shown as such, never as "to do". */
  unread?: StepId[];
  /** Sub-ledger steps still being added up. */
  pending?: StepId[];
}

export function dataSteps(s: DataStatus): DataStep[] {
  return dataStatusOf(s).steps;
}

/** The whole status (steps, next action, health) from the Data page's shape. */
export function dataStatusOf(s: DataStatus): CompanyStatus {
  const modules: Partial<Record<"sales" | "stock" | "ageing", ModuleState>> = {};
  for (const id of s.unread ?? []) if (id === "sales" || id === "stock" || id === "ageing") modules[id] = "failed";
  for (const id of s.pending ?? []) if (id === "sales" || id === "stock" || id === "ageing") modules[id] ??= "pending";
  return companyStatus({
    basePath: s.basePath, booksStart: s.booksStart, opening: s.opening, booksFromZero: s.booksFromZero, openingInLedger: s.openingInLedger,
    books: s.ledger ? { from: s.ledger.from, to: s.ledger.to, basis: s.ledger.odoo ? "odoo" : "ledger" } : s.books ?? null,
    checks: s.openChecks === null ? null : { blocking: s.openChecks, warnings: s.warnings ?? 0 },
    tb: s.tb, sales: s.sales, stock: s.stock, ageing: s.ageing, modules,
  });
}
