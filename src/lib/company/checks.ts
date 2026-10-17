import { addMonths, bsCalc, mlabel, plCalc, type MonthData } from "@/lib/engine";
import { buildMonths, isPL } from "./build";
import type { AccountLine } from "./types";
import { reviewChecks } from "./review";

/** Accounting identity and integrity checks, shared by the upload preview, the server commit, the Data health page and reports. */

export type CheckSeverity = "block" | "warn" | "info";
export const CHECK_IDS = [
  "bs_balance", "control_total", "tb_zero", "unmapped", "duplicate", "multi_month",
  "re_rollforward", "cash_flow", "gap", "statement_mismatch", "sign", "opening",
  "account_rollforward", "cross_check", "future_dated", "partial_month", "contra_balance", "continuity", "review",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

export interface Check {
  id: CheckId;
  severity: CheckSeverity;
  period?: string;
  statement?: "PL" | "BS";
  title: string;
  detail: string;
  expected?: number;
  actual?: number;
  diff?: number;
  /** Failure in a month the current import does not touch (shown, never blocks the import). */
  existing?: boolean;
}

/** A total row read from the source file (e.g. "Total Income", "Net Profit", "Total Assets"). */
export interface ControlTotal {
  metric: ControlMetric;
  period: string;
  value: number;
  source: string;
  /** P&L totals over several months ending at `period` (e.g. Odoo's "From 01/01 to 10/10"): compared with the sum of those months. */
  months?: number;
}
export type ControlMetric = "revenue" | "gross_profit" | "net_income" | "ta" | "tl" | "te" | "tle";
export const CONTROL_LABEL: Record<ControlMetric, string> = {
  revenue: "Total revenue", gross_profit: "Gross profit", net_income: "Net profit", ta: "Total assets", tl: "Total liabilities", te: "Total equity", tle: "Total liabilities and equity",
};

export interface Coverage {
  /** Every month from the first to the last month with any data. */
  range: string[];
  pl: Set<string>;
  bs: Set<string>;
}

/** Which months actually carry P&L and balance-sheet data (buildMonths fills gaps with empty months). */
export function coverageOf(accounts: Pick<AccountLine, "cls" | "amounts">[]): Coverage {
  const pl = new Set<string>(), bs = new Set<string>();
  for (const a of accounts) for (const [p, v] of Object.entries(a.amounts)) if (v) (isPL(a.cls) ? pl : bs).add(p);
  const all = [...pl, ...bs].sort();
  const range: string[] = [];
  if (all.length) for (let p = all[0]; p <= all[all.length - 1]; p = addMonths(p, 1)) range.push(p);
  return { range, pl, bs };
}

/** Rounding tolerance: one currency unit, or 0.01% of total assets for large books. */
export const tolerance = (scale: number) => Math.max(1, Math.abs(scale) * 0.0001);

export interface CheckInput {
  accounts: (Pick<AccountLine, "cls" | "amounts"> & { name?: string })[];
  months?: MonthData[];
  controls?: ControlTotal[];
  /** Extra checks computed elsewhere (ingest: unmapped lines, trial-balance sums, duplicate sheets…). */
  extra?: Check[];
}

export function runChecks({ accounts, months = buildMonths(accounts as AccountLine[]), controls = [], extra = [] }: CheckInput): Check[] {
  const out: Check[] = [...extra];
  const cov = coverageOf(accounts);
  const byP = new Map(months.map((m) => [m.period, m]));
  const fmt = (v: number) => Math.round(v).toLocaleString("en-GB");

  // gaps inside each statement's own range
  for (const [st, set] of [["PL", cov.pl], ["BS", cov.bs]] as const) {
    const s = [...set].sort();
    if (s.length < 2) continue;
    const missing: string[] = [];
    for (let p = s[0]; p <= s[s.length - 1]; p = addMonths(p, 1)) if (!set.has(p)) missing.push(p);
    for (const p of missing) out.push({ id: "gap", severity: "warn", period: p, statement: st, title: `No ${st === "PL" ? "P&L" : "balance sheet"} data`, detail: `This month sits between loaded months but has no ${st === "PL" ? "profit and loss" : "balance sheet"} figures. Upload it so totals and trends are not understated.` });
  }
  // months with one statement but not the other
  if (cov.pl.size && cov.bs.size) {
    for (const p of cov.range) {
      if (cov.pl.has(p) && !cov.bs.has(p)) out.push({ id: "statement_mismatch", severity: "info", period: p, statement: "BS", title: "P&L without a balance sheet", detail: "Cash flow, working capital and return KPIs are not available for this month." });
      else if (cov.bs.has(p) && !cov.pl.has(p)) out.push({ id: "statement_mismatch", severity: "info", period: p, statement: "PL", title: "Balance sheet without a P&L", detail: "Profit KPIs are not available for this month." });
    }
  }

  for (const p of cov.range) {
    const m = byP.get(p);
    if (!m) continue;
    const B = bsCalc(m.bs), P = plCalc(m.pl);
    const tol = tolerance(B.ta);
    if (cov.bs.has(p) && Math.abs(B.imbalance) > tol) {
      out.push({ id: "bs_balance", severity: "block", period: p, statement: "BS", title: "Balance sheet does not balance", detail: `Assets ${fmt(B.ta)} vs liabilities + equity ${fmt(B.tle)}: out by ${fmt(B.imbalance)}. Usually an unmapped or excluded account, current-year profit not closed into equity, or a sign error.`, expected: B.ta, actual: B.tle, diff: B.imbalance });
    }
    // retained earnings roll-forward and cash flow: need the prior month's balance sheet
    const prev = addMonths(p, -1), m0 = byP.get(prev);
    if (m0 && cov.bs.has(p) && cov.bs.has(prev) && cov.pl.has(p)) {
      const B0 = bsCalc(m0.bs);
      const tol2 = Math.max(tol, tolerance(B0.ta));
      // Retained earnings move only by the month's profit less dividends. Owners' capital and current accounts (other
      // equity) move with money paid in or drawn, which is normal and shown in the cash flow, so they are not tested here.
      const dRe = B.retained_earnings - B0.retained_earnings;
      const unexplained = dRe - P.retained_income;
      if (Math.abs(B.imbalance) <= tol && Math.abs(B0.imbalance) <= tol2 && Math.abs(unexplained) > tol2) {
        out.push({ id: "re_rollforward", severity: "warn", period: p, statement: "BS", title: "Retained earnings moved more than the month's profit", detail: `Retained earnings changed by ${fmt(dRe)} but profit after dividends for the month is ${fmt(P.retained_income)} (unexplained ${fmt(unexplained)}). Expected for prior-period adjustments; otherwise check that every P&L account is mapped and that no capital account is mapped as retained earnings.`, expected: P.retained_income, actual: dRe, diff: unexplained });
      }
      // The indirect cash-flow statement needs a balancing line exactly when the imbalance changed.
      const plug = B.imbalance - B0.imbalance;
      if (Math.abs(plug) > tol2) out.push({ id: "cash_flow", severity: "warn", period: p, statement: "BS", title: "Cash flow needs a balancing line", detail: `The cash-flow statement only reconciles to the change in cash with a ${fmt(plug)} balancing line, because the balance sheet imbalance changed. Fix the balance sheet to remove it.`, diff: plug });
    }
    if (cov.pl.has(p) && P.revenue < -tol) out.push({ id: "sign", severity: "warn", period: p, statement: "PL", title: "Negative revenue", detail: `Revenue is ${fmt(P.revenue)}. Check that sales accounts are not mapped as costs or carry the wrong sign.`, actual: P.revenue });
    if (cov.bs.has(p) && B.ta < -tol) out.push({ id: "sign", severity: "warn", period: p, statement: "BS", title: "Negative total assets", detail: `Total assets are ${fmt(B.ta)}. The balance sheet signs look inverted.`, actual: B.ta });
    else if (cov.bs.has(p) && B.cash < -tol) out.push({ id: "sign", severity: "info", period: p, statement: "BS", title: "Negative cash", detail: `Cash is ${fmt(B.cash)}. If this is a bank overdraft, map it to Short Term Debt.`, actual: B.cash });
  }

  // Balances on the wrong side at the latest month: customers in credit, suppliers in debit, a liability with a debit
  // balance. Totals still balance, but days and liquidity measures built on them mean nothing.
  const lastBs = [...cov.bs].sort().pop();
  const mLast = lastBs ? byP.get(lastBs) : undefined;
  if (lastBs && mLast) {
    const B = bsCalc(mLast.bs);
    const material = Math.max(tolerance(B.ta), Math.abs(B.ta) * 0.005);
    const at = (a: CheckInput["accounts"][number]) => a.amounts[lastBs] ?? 0;
    const LIAB = new Set(["ap", "other_cl", "tax_liab"]);
    // "Advance from Customers: debit 39,851,154": the side the balance is on, in the bookkeeper's words.
    const named = (cls: string, neg: boolean) => accounts.filter((a) => a.cls === cls && (neg ? at(a) < -material : at(a) > material))
      .map((a) => `${a.name ?? cls}: ${(at(a) < 0) === LIAB.has(cls) ? "debit" : "credit"} ${fmt(Math.abs(at(a)))}`);
    const LABEL: Record<string, string> = { ar: "Accounts Receivable", inventory: "Inventory", ap: "Accounts Payable", other_cl: "Other Current Liabilities", tax_liab: "Tax Liability", other_ca: "Other Current Assets" };
    for (const cls of ["ar", "ap", "inventory", "other_cl", "tax_liab", "other_ca"] as const) {
      const v = B[cls];
      if (v >= -material) continue;
      const own = named(cls, true);
      let hint = "";
      if (cls === "ar") {
        const elsewhere = named("other_cl", true);
        hint = elsewhere.length ? ` A liability account has a debit balance (${elsewhere.join("; ")}): if customers' unpaid invoices are posted there, change its class to Accounts Receivable in Settings ▸ Chart of accounts.` : " Customer payments or advances exceed invoices: map customer advances to Other Current Liabilities, or correct the postings in Odoo.";
      } else if (cls === "ap") {
        const elsewhere = named("other_ca", true);
        hint = elsewhere.length ? ` An asset account has a credit balance (${elsewhere.join("; ")}): if supplier bills are posted there, change its class to Accounts Payable.` : " Payments to suppliers exceed their bills: map supplier advances to Other Current Assets, or correct the postings in Odoo.";
      } else hint = ` A ${["other_cl", "tax_liab"].includes(cls) ? "liability with a debit balance is money owed to the company and belongs with assets" : "debit-side account with a credit balance belongs with liabilities"}: check each account's class in Settings ▸ Chart of accounts.`;
      out.push({ id: "contra_balance", severity: "warn", period: lastBs, statement: "BS", title: `${LABEL[cls]} on the wrong side`,
        detail: `${LABEL[cls]} total ${fmt(v)} in ${mlabel(lastBs)}${own.length ? ` (${own.join("; ")})` : ""}. ${cls === "ar" ? "Customer days cannot be measured." : cls === "ap" ? "Supplier days cannot be measured." : "Liquidity measures read wrongly."}${hint}`, actual: v });
    }
  }

  // control totals from the source file
  for (const c of controls) {
    const m = byP.get(c.period);
    if (!m) continue;
    const B = bsCalc(m.bs);
    const isPLm = c.metric === "revenue" || c.metric === "gross_profit" || c.metric === "net_income";
    const win = isPLm && (c.months ?? 1) > 1 ? Array.from({ length: c.months! }, (_, i) => addMonths(c.period, i - c.months! + 1)) : [c.period];
    if (win.some((p) => !byP.has(p) || !cov.pl.has(p))) continue;
    const plSum = (k: "revenue" | "gross_profit" | "net_income") => win.reduce((a, p) => a + plCalc(byP.get(p)!.pl)[k], 0);
    let actual = isPLm ? plSum(c.metric as "revenue" | "gross_profit" | "net_income") : B[c.metric as "ta" | "tl" | "te" | "tle"];
    // Balance-sheet totals are compared by size: some exports print liabilities and equity as negatives.
    if (!isPLm && Math.sign(actual) !== Math.sign(c.value)) actual = -actual;
    const diff = actual - c.value;
    if (Math.abs(diff) > tolerance(Math.max(Math.abs(c.value), Math.abs(B.ta)))) {
      // Gross profit depends on where cost lines are mapped (cost of sales vs expenses), so it only warns.
      out.push({ id: "control_total", severity: c.metric === "gross_profit" ? "warn" : "block", period: c.period, statement: c.metric === "revenue" || c.metric === "gross_profit" || c.metric === "net_income" ? "PL" : "BS", title: `${CONTROL_LABEL[c.metric]} does not match the file`, detail: `The file says ${fmt(c.value)}${win.length > 1 ? ` for ${win.length} months` : ""} (${c.source}); the imported accounts add up to ${fmt(actual)}, a difference of ${fmt(diff)}. Some lines are probably excluded, double counted or mapped to the wrong class.`, expected: c.value, actual, diff });
    }
  }
  // The accountant's review: questions about books that already balance (warnings, never blocks).
  out.push(...reviewChecks({ accounts, months }));
  return out;
}

export interface CheckSummary { block: number; warn: number; info: number; byPeriod: Record<string, Check[]> }

export function summarize(checks: Check[]): CheckSummary {
  const byPeriod: Record<string, Check[]> = {};
  for (const c of checks) if (c.period) (byPeriod[c.period] ??= []).push(c);
  return { block: checks.filter((c) => c.severity === "block").length, warn: checks.filter((c) => c.severity === "warn").length, info: checks.filter((c) => c.severity === "info").length, byPeriod };
}

/** Stable identity for accepting a specific failure ("import anyway"). */
export const checkKey = (c: Pick<Check, "id" | "period" | "statement">) => `${c.id}:${c.statement ?? ""}:${c.period ?? ""}`;

/** The same failure in several months, shown once: same check and statement, and the same difference each month. */
export function groupChecks<T extends Check>(checks: T[]): { check: T; periods: string[] }[] {
  const out: { check: T; periods: string[] }[] = [];
  for (const c of checks) {
    const g = c.period && c.diff !== undefined ? out.find((x) => x.check.id === c.id && x.check.statement === c.statement && x.check.severity === c.severity
      && Boolean(x.check.existing) === Boolean(c.existing) && x.check.diff !== undefined && Math.abs(x.check.diff - c.diff!) <= 1 && x.periods.length) : undefined;
    if (g) g.periods.push(c.period!);
    else out.push({ check: c, periods: c.period ? [c.period] : [] });
  }
  return out;
}

/** "Jan 2026", or "Jan 2026 – Oct 2026 (10 months)". */
export function periodsLabel(ps: string[], label: (p: string) => string): string {
  if (!ps.length) return "";
  const s = [...ps].sort();
  return s.length === 1 ? label(s[0]) : `${label(s[0])} – ${label(s[s.length - 1])} (${s.length} months)`;
}
