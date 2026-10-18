// Odoo prints many reports besides the account balances. Uploaded as accounts, their figures would be read as balances
// (an Aged Payable's partners as accounts, a cash flow statement's loans as cash): each one is recognised, by the sheet
// name Odoo gives it or by its layout, and named with where its figures are used instead.
import { normAr, type Cell } from "./parse";
import type { Grid } from "./extract";
import { readAged } from "./aged";

export interface OtherReport { title: string; why: string }

const text = (v: Cell) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const norm = (s: string) => normAr(s).toLowerCase().replace(/[^\p{L}\p{N}>]+/gu, " ").trim();

const BY_NAME: [RegExp, string, string][] = [
  [/^aged receivable$/, "Aged Receivable", "it lists open customer invoices by age; it is checked against the receivable account, not read as balances"],
  [/^aged payable$/, "Aged Payable", "it lists open supplier bills by age; it is checked against the payable account, not read as balances"],
  [/^cash flow statement$/, "Cash Flow Statement", "iReport works out the cash flow from the balances itself (Odoo's counts loans and overdrafts as cash)"],
  [/^customer statement$/, "Customer Statement", "it lists each partner's movements; the balances come from the Trial Balance or General Ledger"],
  [/^partner ledger$/, "Partner Ledger", "it lists each partner's movements; the balances come from the Trial Balance or General Ledger"],
  [/^follow up report$/, "Follow-Up Report", "it lists unpaid items per partner for chasing, not account balances"],
  [/^executive summary$/, "Executive Summary", "its figures are totals iReport works out itself from the balances"],
  [/^(generic )?tax report$/, "Generic Tax report", "it is the VAT return; VAT balances come from the Trial Balance or General Ledger"],
  [/^group by account > tax$/, "Group by Account > Tax", "it is the VAT return by account; VAT balances come from the Trial Balance or General Ledger"],
  [/^group by tax > account$/, "Group by Tax > Account", "it is the VAT return by tax; VAT balances come from the Trial Balance or General Ledger"],
  [/^depreciation schedule$/, "Depreciation Schedule", "it is the asset register; fixed assets and depreciation come from the Trial Balance or General Ledger"],
  [/^unrealized currency gains ?losse?s?$/, "Unrealized Currency Gains/Losses", "it is a revaluation proposal, not posted balances"],
  [/^bank reconciliation report$/, "Bank Reconciliation Report", "it lists unreconciled bank items, not account balances"],
  [/^deferred (expense|revenue) report$/, "Deferred Expense / Revenue Report", "it schedules deferrals, not account balances"],
  [/^(generic )?ec sales list$/, "EC Sales List", "it is a European VAT list, not account balances"],
];
const JOURNAL_HEAD = /^document$/i;

/** The Odoo report a sheet is, when it is not an export of account balances; null for the balance exports and anything else. */
export function otherOdooReport(g: Grid): OtherReport | null {
  const name = norm(g.name.split(" › ").pop() ?? "");
  for (const [rx, title, why] of BY_NAME) if (rx.test(name)) return { title, why };
  const rows = g.rows.slice(0, 60);
  const labels = rows.map((r) => norm(text(r?.[0]))).concat(rows.map((r) => norm(text(r?.[1]))));
  // Odoo's Journal Report: one sheet per journal, headed Document | Account Code | Account Label | Name | Debit | Credit.
  const head = rows.find((r) => JOURNAL_HEAD.test(text(r?.[0])));
  if (head && /account code/i.test(text(head[1])) && /debit/i.test(head.map(text).join(" "))) return { title: "Journal Report", why: "it lists each journal's entries for printing; the balances come from the Trial Balance or General Ledger" };
  if (labels.some((l) => l.startsWith("cash and cash equivalents beginning of period"))) return { title: "Cash Flow Statement", why: BY_NAME[2][2] };
  if (labels.includes("cash received") && labels.includes("closing bank balance")) return { title: "Executive Summary", why: BY_NAME[6][2] };
  const aged = readAged(g);
  if (aged) return aged.side === "receivable" ? { title: "Aged Receivable", why: BY_NAME[0][2] } : { title: "Aged Payable", why: BY_NAME[1][2] };
  return null;
}
