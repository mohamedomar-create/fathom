import { plCalc, type MonthData } from "@/lib/engine";
import type { Check } from "@/lib/company/checks";
import type { ExpenseFlag } from "@/lib/engine/expenses";

/**
 * The AI system doctor's findings: every check and flag the system already makes for a company, as one list ranked by
 * the money at stake, with a health score. Rules only, from the company's own books: no AI and no cost. The AI is used
 * only when someone asks it to explain a finding (lib/doctor/ai.ts).
 */
export type Area = "books" | "sales" | "expenses" | "stock" | "payments" | "setup";
export type Basis = "difference" | "unexplained" | "cash tied up" | "margin at risk" | "possible double payment" | "unusual payment";
export interface Decision { key: string; reason: string; at: string; by?: string; id?: string }
export interface Finding {
  key: string; area: Area; severity: "high" | "medium" | "low"; title: string; detail: string; period?: string;
  /** EGP at stake (null when the finding has no amount), and what that amount means. */
  impact: number | null; basis: Basis | null;
  /** The page where it is looked into or fixed. */
  href: string;
  accepted?: Decision;
}

/** Customer days above this are counted as cash tied up. */
export const NORMAL_DAYS = 60;

const annualRevenue = (months: MonthData[]) => {
  const pl = months.filter((m) => !m.has || m.has.pl).filter((m) => Object.keys(m.pl).length).slice(-3);
  return pl.length ? (pl.reduce((t, m) => t + plCalc(m.pl).revenue, 0) / pl.length) * 12 : 0;
};

export function doctorFindings({ checks, expenseFlags = [], months, basePath, decisions = [] }: { checks: Check[]; expenseFlags?: ExpenseFlag[]; months: MonthData[]; basePath: string; decisions?: Decision[] }): Finding[] {
  const yearRev = annualRevenue(months);
  const revenueOf = (p?: string) => { const m = months.find((x) => x.period === p); return m ? plCalc(m.pl).revenue : 0; };
  const sev = (block: boolean, impact: number | null): Finding["severity"] => (block ? "high" : impact !== null && yearRev > 0 && impact >= yearRev * 0.01 ? "medium" : "low");
  const out: Finding[] = [];
  for (const c of checks) {
    if (c.severity === "info") continue;
    const key = `${c.id}|${c.period ?? ""}|${c.title}`;
    let impact: number | null = c.diff !== undefined ? Math.abs(c.diff) : null;
    let basis: Basis | null = impact !== null ? "difference" : null;
    let area: Area = c.id === "unmapped" ? "setup" : "books";
    let href = `${basePath}/data/checks`;
    if (c.id === "review") {
      if (/^(Customer|Supplier) days/.test(c.title)) {
        area = "payments"; href = `${basePath}/settings/chart-of-accounts`;
        const days = c.actual ?? 0;
        if (c.title.startsWith("Customer") && days > NORMAL_DAYS && yearRev > 0) { impact = Math.round(((days - NORMAL_DAYS) * yearRev) / 365); basis = "cash tied up"; }
      } else if (/^Gross margin/.test(c.title) && c.actual !== undefined && c.expected !== undefined) {
        area = "sales"; href = `${basePath}/analysis/profitability`;
        impact = Math.round(Math.abs(c.actual - c.expected) * revenueOf(c.period)); basis = "margin at risk";
      } else if (c.actual !== undefined && c.statement === "BS") {
        if (/interim|stock|received|delivered/i.test(c.title)) area = "stock";
        impact = Math.round(Math.abs(c.actual)); basis = "unexplained";
      }
    }
    out.push({ key, area, severity: sev(c.severity === "block", impact), title: c.title, detail: c.detail, period: c.period, impact, basis, href });
  }
  for (const x of expenseFlags) {
    const double = x.k === "double";
    const impact = Math.round(Math.abs(x.a));
    out.push({
      key: `flag|${x.k}|${x.doc}|${x.doc2 ?? ""}`, area: "expenses", severity: sev(false, impact),
      title: double ? `Possible double payment to ${x.s}` : `Unusually large bill from ${x.s}`,
      detail: double ? `${x.doc} and ${x.doc2 ?? "another bill"} for ${x.t} carry the same amount close together. Check that it was not paid twice.` : `${x.doc} for ${x.t} is far above the usual amount for this supplier.`,
      period: x.p, impact, basis: double ? "possible double payment" : "unusual payment", href: `${basePath}/expenses`,
    });
  }
  const accepted = new Map(decisions.map((d) => [d.key, d]));
  for (const f of out) { const d = accepted.get(f.key); if (d) f.accepted = d; }
  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => Number(!!a.accepted) - Number(!!b.accepted) || (b.impact ?? -1) - (a.impact ?? -1) || rank[a.severity] - rank[b.severity] || a.key.localeCompare(b.key));
}

/**
 * 0–100: 100 less 15 for each open serious finding, 5 for each medium and 1 for each small one, and up to 30 for the
 * money at stake as a share of a year's sales. Accepted findings don't count.
 */
export function healthScore(findings: Finding[], months: MonthData[]): { score: number; open: number; atStake: number } {
  const open = findings.filter((f) => !f.accepted);
  const atStake = open.reduce((t, f) => t + (f.impact ?? 0), 0);
  const yearRev = annualRevenue(months);
  const weight = { high: 15, medium: 5, low: 1 };
  const money = yearRev > 0 ? Math.min(30, Math.round((100 * atStake) / yearRev)) : 0;
  const score = Math.max(0, 100 - open.reduce((t, f) => t + weight[f.severity], 0) - money);
  return { score, open: open.length, atStake };
}
