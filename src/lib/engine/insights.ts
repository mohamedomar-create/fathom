import { div, fixed, money, pct } from "./format";
import { KPI_DEFS } from "./kpis";
import type { Waterfall } from "./cashflow";
import type { BSCalc, PLCalc } from "./types";

export type FindingKind = "risk" | "watch" | "win";
export type FindingSection = "trend" | "kpis" | "profitability" | "cashflow" | "bs";
export interface Finding { sev: 1 | 2 | 3; kind: FindingKind; section: FindingSection; title: string; text: string }

export interface InsightCtx {
  P: PLCalc;
  B: BSCalc;
  Pprev: PLCalc | null;
  K: Record<string, number | null>;
  W: Waterfall | null;
  /** Resolved targets (company settings over KPI defaults). */
  tg: Record<string, number | null>;
  Ps: PLCalc[];
  Bs: BSCalc[];
  days: number;
  status: Record<string, boolean | null>;
  cur: string;
  /** "last month" | "the prior quarter" | "the prior year" */
  priorLabel?: string;
}

/** Rule-based findings in plain language, ranked by severity (port of the reference engine). */
export function insights(ctx: InsightCtx): Finding[] {
  const { P, B, Pprev: Pp, K, W, tg, Ps, Bs, cur } = ctx;
  const m = (v: number) => money(v, cur);
  const prior = ctx.priorLabel ?? "last month";
  const out: Finding[] = [];
  const add = (sev: 1 | 2 | 3, kind: FindingKind, section: FindingSection, title: string, text: string) => out.push({ sev, kind, section, title, text });
  const R = P.revenue;

  if (Pp && Pp.revenue) {
    const ch = ((R - Pp.revenue) / Math.abs(Pp.revenue)) * 100;
    if (Math.abs(ch) >= 5)
      add(Math.abs(ch) >= 10 ? 2 : 1, ch > 0 ? "win" : "risk", "trend", `Revenue ${ch > 0 ? "up" : "down"} ${fixed(Math.abs(ch), 1)}% on ${prior}`,
        `${m(R)} against ${m(Pp.revenue)}. ` + (ch > 0 ? "Check it is repeatable, not a one-off order." : "Find out which customers or products drove the drop."));
  }
  const tRev = tg.total_revenue;
  if (tRev) {
    const gap = ((R - tRev) / tRev) * 100;
    add(gap < -5 ? 2 : 1, gap >= 0 ? "win" : gap < -5 ? "risk" : "watch", "kpis", `Revenue is ${fixed(Math.abs(gap), 1)}% ${gap >= 0 ? "above" : "below"} target`, `${m(R)} against a target of ${m(tRev)}.`);
  }
  if (Ps.length >= 6) {
    const s = (a: PLCalc[]) => a.reduce((x, p) => x + p.revenue, 0);
    const last3 = s(Ps.slice(-3)), prev3 = s(Ps.slice(-6, -3));
    if (prev3) {
      const g3 = ((last3 - prev3) / prev3) * 100;
      if (Math.abs(g3) >= 3)
        add(1, g3 > 0 ? "win" : "watch", "trend", `Last 3 months ${g3 > 0 ? "ahead of" : "behind"} the 3 months before by ${fixed(Math.abs(g3), 1)}%`,
          "A trend over three months is more reliable than one month on its own.");
    }
  }
  const gpm = K.gpm;
  const tgtG = tg.gpm ?? 35;
  if (gpm !== null && gpm !== undefined) {
    if (Pp && Pp.revenue) {
      const d = gpm - (Pp.gross_profit / Pp.revenue) * 100;
      if (Math.abs(d) >= 1)
        add(d < 0 ? 2 : 1, d < 0 ? "risk" : "win", "profitability", `Gross margin ${d < 0 ? "fell" : "rose"} ${fixed(Math.abs(d), 1)} points`,
          `Now ${pct(gpm, 1)} (was ${pct(gpm - d, 1)}). ` + (d < 0 ? "Check supplier prices, discounts and product mix." : "Hold on to whatever drove this."));
    }
    if (gpm < tgtG) add(2, "risk", "kpis", `Gross margin ${pct(gpm, 1)} is under the ${pct(tgtG, 0)} target`, `Each 1 point is worth about ${m(R * 0.01)} a month at this revenue.`);
  }
  const vcr = div(P.variable_costs, R);
  if (R && vcr !== null && vcr < 1) {
    const bep = P.fixed_costs / (1 - vcr);
    const mos = ((R - bep) / R) * 100;
    if (R < bep) add(3, "risk", "profitability", "Below breakeven: the business is losing money on operations", `It needs ${m(bep)} of revenue to cover its costs and made ${m(R)}, a shortfall of ${m(bep - R)}.`);
    else if (mos < 15) add(2, "watch", "profitability", `Thin safety cushion: revenue can fall only ${fixed(mos, 0)}% before losses start`, `Breakeven is ${m(bep)} against revenue of ${m(R)}.`);
    else add(1, "win", "profitability", `Comfortable cushion: revenue can fall ${fixed(mos, 0)}% before losses start`, `Breakeven is ${m(bep)}.`);
    const cm = R - P.variable_costs;
    if (P.ebit > 0) {
      const dol = cm / P.ebit;
      if (dol > 3) add(1, "watch", "profitability", `High operating leverage (${fixed(dol, 1)}x)`, `A 10% change in revenue moves EBIT by about ${fixed(dol * 10, 0)}%. Good when sales grow, painful when they fall.`);
    }
  }
  if (P.ebit < 0) add(3, "risk", "profitability", "Operating loss this month", `EBIT is ${m(P.ebit)}.`);
  if (W) {
    const { ocf, ncf } = W;
    if (P.ebit > 0 && ocf < 0) add(3, "risk", "cashflow", "Profit is not turning into cash", `EBIT is ${m(P.ebit)} but operating cash flow is ${m(ocf)}. Look at receivables, stock and payables first.`);
    else if (ocf > 0 && P.ebit > 0 && ocf < 0.5 * P.ebit) add(1, "watch", "cashflow", "Less than half of profit became cash", `Operating cash flow ${m(ocf)} vs EBIT ${m(P.ebit)}.`);
    const ncfs: number[] = [];
    for (let i = Math.max(1, Bs.length - 3); i < Bs.length; i++)
      ncfs.push(Bs[i].cash - Bs[i - 1].cash - (Bs[i].std + Bs[i].ltd - (Bs[i - 1].std + Bs[i - 1].ltd)));
    const sum = ncfs.reduce((a, b) => a + b, 0);
    if (ncfs.length && sum < 0 && B.cash > 0) {
      const burn = -sum / ncfs.length;
      add(B.cash / burn < 3 ? 3 : 2, "risk", "cashflow", `Cash is shrinking: about ${fixed(B.cash / burn, 1)} months of runway`,
        `Average net cash outflow is ${m(burn)} a month over the last ${ncfs.length} months; cash on hand is ${m(B.cash)}.`);
    } else if (ncf > 0 && ncfs.length >= 2 && ncfs.every((x) => x > 0)) add(1, "win", "cashflow", `Cash has grown ${ncfs.length} months in a row`, `Cash on hand is ${m(B.cash)}.`);
  }
  if (B.cash < 0) add(3, "risk", "cashflow", "Negative cash balance", "Check for an overdraft that should sit in short-term debt.");
  for (const [key, nm, hint] of [
    ["ar_days", "Customers take", "Chase overdue invoices; tighten credit terms."],
    ["inv_days", "Stock sits for", "Slow-moving stock ties up cash; review reorder levels."],
  ] as const) {
    const v = K[key];
    const tgt = tg[key] ?? (key === "ar_days" ? 45 : 60);
    if (v !== null && v !== undefined && tgt && v > tgt * 1.1) {
      const tied = ((v - tgt) / ctx.days) * (key === "ar_days" ? R : P.cos);
      add(2, "risk", "kpis", `${nm} ${fixed(v, 0)} days (target ${fixed(tgt, 0)})`, `About ${m(tied)} extra cash is tied up. ${hint}`);
    }
  }
  const { ap_days: ap, ar_days: ar, inv_days: inv } = K;
  if (ap != null && ar != null && inv != null) {
    const ccc = ar + inv - ap;
    if (ccc > 60) add(1, "watch", "kpis", `Cash conversion cycle is ${fixed(ccc, 0)} days`, "That is how long money is out before it comes back (receivable days + stock days - supplier days).");
  }
  const cr = K.current;
  if (cr != null && cr < 1) add(3, "risk", "kpis", `Current ratio ${fixed(cr, 2)}: short-term bills exceed short-term assets`, "Risk of not meeting payments on time.");
  else if (cr != null && cr < 1.2) add(1, "watch", "kpis", `Current ratio only ${fixed(cr, 2)}`, "Thin buffer for short-term bills.");
  const ic = K.int_cover;
  if (ic != null && ic < 1.5 && P.net_interest > 0) add(ic < 1 ? 3 : 2, "risk", "kpis", `Interest cover ${fixed(ic, 1)}x`, "Operating profit barely covers interest cost.");
  if (B.te > 0 && B.debt / B.te > 1.5) add(2, "watch", "kpis", `Debt is ${fixed(B.debt / B.te, 1)}x equity`, "High borrowing relative to owners' capital.");
  if (R && P.fixed_costs / R > 0.35) add(1, "watch", "profitability", `Fixed costs take ${fixed((P.fixed_costs / R) * 100, 0)}% of revenue`, "Costs that do not move with sales are what make slow months hurt.");
  const crit = KPI_DEFS.filter((d) => d.importance === "Critical" && ctx.status[d.key] === false).map((d) => d.name);
  if (crit.length) add(2, "risk", "kpis", `${crit.length} critical KPI${crit.length > 1 ? "s" : ""} off target`, crit.join(", ") + ".");
  if (Math.abs(B.imbalance) > 0.5) add(3, "risk", "bs", "Balance sheet does not balance", `Out by ${m(B.imbalance)}. Fix the source data before relying on cash flow, ROE or liquidity numbers.`);
  out.sort((a, b) => b.sev - a.sev || Number(a.kind !== "risk") - Number(b.kind !== "risk"));
  return out;
}
