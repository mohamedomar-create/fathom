import { addMonths, bsCalc, plCalc, type MonthData } from "@/lib/engine";
import { buildMonths, isPL } from "./build";
import type { AccountLine } from "./types";

/** Accounting identity and integrity checks, shared by the upload preview, the server commit, the Data health page and reports. */

export type CheckSeverity = "block" | "warn" | "info";
export type CheckId =
  | "bs_balance" | "control_total" | "tb_zero" | "unmapped" | "duplicate" | "multi_month"
  | "re_rollforward" | "cash_flow" | "gap" | "statement_mismatch" | "sign" | "opening";

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
  accounts: Pick<AccountLine, "cls" | "amounts">[];
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
      const unexplained = B.te - B0.te - P.retained_income;
      if (Math.abs(B.imbalance) <= tol && Math.abs(B0.imbalance) <= tol2 && Math.abs(unexplained) > tol2) {
        out.push({ id: "re_rollforward", severity: "warn", period: p, statement: "BS", title: "Equity moved more than the month's profit", detail: `Equity changed by ${fmt(B.te - B0.te)} but retained profit for the month is ${fmt(P.retained_income)} (unexplained ${fmt(unexplained)}). Expected for capital injections or prior-period adjustments; otherwise check the mapping of equity and P&L accounts.`, expected: P.retained_income, actual: B.te - B0.te, diff: unexplained });
      }
      // The indirect cash-flow statement needs a balancing line exactly when the imbalance changed.
      const plug = B.imbalance - B0.imbalance;
      if (Math.abs(plug) > tol2) out.push({ id: "cash_flow", severity: "warn", period: p, statement: "BS", title: "Cash flow needs a balancing line", detail: `The cash-flow statement only reconciles to the change in cash with a ${fmt(plug)} balancing line, because the balance sheet imbalance changed. Fix the balance sheet to remove it.`, diff: plug });
    }
    if (cov.pl.has(p) && P.revenue < -tol) out.push({ id: "sign", severity: "warn", period: p, statement: "PL", title: "Negative revenue", detail: `Revenue is ${fmt(P.revenue)}. Check that sales accounts are not mapped as costs or carry the wrong sign.`, actual: P.revenue });
    if (cov.bs.has(p) && B.ta < -tol) out.push({ id: "sign", severity: "warn", period: p, statement: "BS", title: "Negative total assets", detail: `Total assets are ${fmt(B.ta)}. The balance sheet signs look inverted.`, actual: B.ta });
    else if (cov.bs.has(p) && B.cash < -tol) out.push({ id: "sign", severity: "info", period: p, statement: "BS", title: "Negative cash", detail: `Cash is ${fmt(B.cash)}. If this is a bank overdraft, map it to Short Term Debt.`, actual: B.cash });
  }

  // control totals from the source file
  for (const c of controls) {
    const m = byP.get(c.period);
    if (!m) continue;
    const P = plCalc(m.pl), B = bsCalc(m.bs);
    const isPLm = c.metric === "revenue" || c.metric === "gross_profit" || c.metric === "net_income";
    let actual = c.metric === "revenue" ? P.revenue : c.metric === "gross_profit" ? P.gross_profit : c.metric === "net_income" ? P.net_income : B[c.metric];
    // Balance-sheet totals are compared by size: some exports print liabilities and equity as negatives.
    if (!isPLm && Math.sign(actual) !== Math.sign(c.value)) actual = -actual;
    const diff = actual - c.value;
    if (Math.abs(diff) > tolerance(Math.max(Math.abs(c.value), Math.abs(B.ta)))) {
      // Gross profit depends on where cost lines are mapped (cost of sales vs expenses), so it only warns.
      out.push({ id: "control_total", severity: c.metric === "gross_profit" ? "warn" : "block", period: c.period, statement: c.metric === "revenue" || c.metric === "gross_profit" || c.metric === "net_income" ? "PL" : "BS", title: `${CONTROL_LABEL[c.metric]} does not match the file`, detail: `The file says ${fmt(c.value)} (${c.source}); the imported accounts add up to ${fmt(actual)}, a difference of ${fmt(diff)}. Some lines are probably excluded, double counted or mapped to the wrong class.`, expected: c.value, actual, diff });
    }
  }
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
