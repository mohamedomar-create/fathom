import { addMonths, BS_KEYS, PL_KEYS, type ClassKey } from "@/lib/engine";
import { buildMonths, CREDIT_CLASSES, isPL, toNatural } from "@/lib/company/build";
import { bsCalc, plCalc } from "@/lib/engine";
import type { AccountLine } from "@/lib/company/types";
import { classify, CONTRA_REVENUE } from "./classify";
import { extractGrid, type Grid, type RawLine } from "./extract";
import { normLabel } from "./parse";

export interface IngestOptions {
  fyStart: number;
  ytd: "auto" | "yes" | "no";
  closeEarnings: boolean | "auto";
  plugEquity: boolean;
  /** Overrides by line key or normalised label → class ("" = exclude). */
  mapping: Record<string, ClassKey | "">;
}

export interface IngestLine {
  key: string;
  sheet: string;
  row: number;
  code: string;
  name: string;
  label: string;
  section: string;
  cls: ClassKey | null;
  conf: number;
  why: string;
  excluded: boolean;
  system: boolean;
  /** Natural presentation sign, per period (P&L: month; BS: closing). */
  values: Record<string, number>;
}

export interface IngestResult {
  lines: IngestLine[];
  periods: string[];
  kind: "natural" | "movement" | "mixed";
  detected: { ytd: boolean; creditNegative: boolean; unclosedEarnings: boolean };
  issues: { warnings: string[]; notes: string[]; flips: string[]; subtotals: string[]; skippedCols: string[] };
  imbalance: Record<string, number>;
  totals: { revenue: Record<string, number>; cash: Record<string, number> };
}

const COSTS = new Set<ClassKey>(["cos_variable", "cos_fixed", "cos_depreciation", "exp_variable", "exp_fixed", "exp_depreciation", "other_expenses", "interest_expenses", "tax_expenses", "adjustments", "dividends"]);
const SUBTOTAL = /^\s*(total|sub.?total|grand total|gross (profit|margin|loss)|net (income|profit|loss|earnings|sales)|operating (profit|income|loss)|ebit(da)?\b|profit (before|after)|(income|earnings) before|working capital|check|difference|balance check|الإجمالي|اجمالي|إجمالي|مجموع|صافي (الربح|الدخل|الخسارة)|مجمل (الربح|الخسارة))/i;

const fyOf = (p: string, fy: number) => { const [y, m] = p.split("-").map(Number); return m >= fy ? y : y - 1; };
function continuous(ps: string[]) {
  const s = [...new Set(ps)].sort();
  if (!s.length) return [];
  const out: string[] = [];
  for (let p = s[0]; p <= s[s.length - 1]; p = addMonths(p, 1)) out.push(p);
  return out;
}

export function extractAll(grids: Grid[]) {
  const issues = { skippedCols: [] as string[], warnings: [] as string[] };
  const raw = grids.flatMap((g) => extractGrid(g, issues));
  return { raw, issues };
}

export function runIngest(raw: RawLine[], extractIssues: { skippedCols: string[]; warnings: string[] }, opts: IngestOptions): IngestResult {
  const issues = { warnings: [...extractIssues.warnings], notes: [] as string[], flips: [] as string[], subtotals: [] as string[], skippedCols: [...extractIssues.skippedCols] };
  // ---- subtotal removal (natural lines only; movement exports are per account)
  const skip = new Set<string>();
  raw.forEach((r) => {
    if (r.kind === "natural" && SUBTOTAL.test(r.name) && !(r.stmt === "BS" && /^\s*net (profit|income|loss|earnings)/i.test(r.name))) {
      skip.add(r.key); issues.subtotals.push(`${r.sheet} row ${r.row}: '${r.label}' (name looks like a computed total)`);
    }
  });
  raw.forEach((r, i) => {
    if (r.kind !== "natural" || skip.has(r.key) || !r.row) return;
    const ps = Object.keys(r.values);
    if (!ps.some((p) => r.values[p])) return;
    const run: Record<string, number> = Object.fromEntries(ps.map((p) => [p, 0]));
    for (let j = i + 1; j < Math.min(i + 40, raw.length); j++) {
      const n = raw[j];
      if (n.sheet !== r.sheet || skip.has(n.key)) continue;
      for (const p of ps) run[p] += n.values[p] ?? 0;
      if (j - i >= 2 && ps.every((p) => Math.abs(run[p] - (r.values[p] ?? 0)) <= 1) && ps.some((p) => run[p])) {
        skip.add(r.key); issues.subtotals.push(`${r.sheet} row ${r.row}: '${r.label}' (equals the sum of the ${j - i} rows below it)`); break;
      }
    }
  });
  const used = raw.filter((r) => !skip.has(r.key));

  // ---- classify
  const map = opts.mapping;
  const lines = used.map((r) => {
    const override = map[r.key] ?? map[normLabel(r.label)];
    const c = override !== undefined
      ? { cls: (override || null) as ClassKey | null, conf: 1, why: override ? "your mapping" : "excluded by you" }
      : classify(r.name, r.section, r.stmt, {}, r.code);
    return { r, ...c, excluded: override === "" };
  });

  // ---- sign handling
  const nat = lines.filter((l) => l.r.kind === "natural" && l.cls);
  const mov = lines.filter((l) => l.r.kind === "movement" && l.cls);
  const values = new Map<string, Record<string, number>>();

  // natural lines: contra revenue, trial-balance sign detection, negative costs
  const classSum = (k: ClassKey) => nat.filter((l) => l.cls === k).reduce((s, l) => s + Object.values(l.r.values).reduce((a, b) => a + b, 0), 0);
  for (const l of nat) values.set(l.r.key, Object.fromEntries(Object.entries(l.r.values).map(([p, v]) => [p, l.cls === "revenue" && CONTRA_REVENUE.test(l.r.name) ? -Math.abs(v) : v])));
  const credSigns = (["revenue", "ap", "std", "ltd", "other_cl", "tax_liab", "other_equity"] as ClassKey[]).map((k) => classSum(k)).filter((s) => Math.abs(s) > 0).map((s) => (s > 0 ? 1 : -1));
  const creditNegative = credSigns.length > 0 && credSigns.reduce((a: number, b) => a + b, 0) < 0 && credSigns.filter((s) => s < 0).length >= Math.max(2, Math.floor(credSigns.length / 2) + 1);
  if (creditNegative) {
    issues.flips.push("Credit-side lines (revenue, liabilities, equity, other/interest income) arrive as negatives (trial-balance sign). Flipped to positive.");
    for (const l of nat) if (CREDIT_CLASSES.has(l.cls!)) { const v = values.get(l.r.key)!; for (const p in v) v[p] = -v[p]; }
  }
  for (const k of COSTS) {
    if (k === "adjustments") continue;
    const ls = nat.filter((l) => l.cls === k);
    const s = ls.reduce((a, l) => a + Object.values(values.get(l.r.key)!).reduce((x, y) => x + y, 0), 0);
    if (ls.length && s < 0) {
      if (!creditNegative) {
        issues.flips.push(`'${k.replace(/_/g, " ")}' arrives negative (costs shown as negatives). Flipped to positive.`);
        for (const l of ls) { const v = values.get(l.r.key)!; for (const p in v) v[p] = -v[p]; }
      } else issues.warnings.push(`'${k.replace(/_/g, " ")}' is negative while the file otherwise uses debit-positive costs; check sign or mapping.`);
    }
  }

  // periods
  const plP = continuous(nat.filter((l) => isPL(l.cls!)).flatMap((l) => Object.keys(l.r.values)));
  const bsP = continuous(nat.filter((l) => !isPL(l.cls!)).flatMap((l) => Object.keys(l.r.values)));
  const movP = continuous(mov.flatMap((l) => Object.keys(l.r.values)));
  let periods: string[];
  if (mov.length && !nat.length) periods = movP;
  else if (plP.length && bsP.length) {
    periods = plP.filter((p) => bsP.includes(p));
    if (plP.length !== bsP.length || periods.length !== plP.length) issues.warnings.push(`P&L has ${plP.length} months, balance sheet ${bsP.length}; using the ${periods.length} months present in both.`);
  } else periods = continuous([...plP, ...bsP, ...movP]);
  if (nat.length && !bsP.length && !mov.length) issues.warnings.push("NO BALANCE SHEET FOUND. Cash flow, working-capital, liquidity and return KPIs will be empty or wrong. Add a balance sheet export.");
  if (nat.length && !plP.length && !mov.length) issues.warnings.push("NO P&L FOUND. Add the Profit and Loss export.");

  // YTD detection (natural P&L lines)
  const revBy = (p: string) => nat.filter((l) => l.cls === "revenue").reduce((s, l) => s + (values.get(l.r.key)![p] ?? 0), 0);
  let decum = opts.ytd === "yes";
  if (opts.ytd === "auto" && plP.length >= 6) {
    let inc = 0, tot = 0, resets = 0;
    for (let i = 1; i < plP.length; i++) {
      const p0 = plP[i - 1], p1 = plP[i];
      if (fyOf(p0, opts.fyStart) === fyOf(p1, opts.fyStart)) { if (revBy(p0)) { tot++; if (revBy(p1) >= revBy(p0)) inc++; } }
      else if (revBy(p1) < revBy(p0) * 0.6) resets++;
    }
    if (tot && inc / tot >= 0.9 && (resets || new Set(plP.map((p) => fyOf(p, opts.fyStart))).size === 1)) decum = true;
  }
  if (decum) {
    issues.notes.push("P&L columns were cumulative (year-to-date); converted to single months by subtracting the prior month inside each financial year.");
    for (const l of nat) if (isPL(l.cls!)) {
      const v = values.get(l.r.key)!;
      const ps = Object.keys(v).sort();
      const out: Record<string, number> = {};
      ps.forEach((p, i) => { const prev = ps[i - 1]; out[p] = v[p] - (prev && fyOf(prev, opts.fyStart) === fyOf(p, opts.fyStart) ? v[prev] : 0); });
      values.set(l.r.key, out);
    }
  }

  // movement lines → natural (P&L: monthly movement; BS: opening + cumulative movement)
  for (const l of mov) {
    const cls = l.cls!;
    const out: Record<string, number> = {};
    if (isPL(cls)) for (const p of periods) { const v = l.r.values[p]; if (v) out[p] = toNatural(cls, v); }
    else { let run = l.r.opening; for (const p of periods) { run += l.r.values[p] ?? 0; if (run) out[p] = toNatural(cls, run); } }
    values.set(l.r.key, out);
  }

  // restrict to the chosen periods
  const result: IngestLine[] = lines.map((l) => {
    const v = values.get(l.r.key) ?? {};
    const vv = Object.fromEntries(Object.entries(v).filter(([p, x]) => periods.includes(p) && x));
    return { key: l.r.key, sheet: l.r.sheet, row: l.r.row, code: l.r.code, name: l.r.name, label: l.r.label, section: l.r.section, cls: l.cls, conf: l.conf, why: l.why, excluded: l.excluded || !l.cls, system: false, values: vv };
  });

  // Movement exports: P&L accounts are never closed in Odoo, so earnings to date are carried into retained earnings.
  if (mov.length) {
    const re: Record<string, number> = {};
    let run = mov.filter((l) => isPL(l.cls!)).reduce((s, l) => s + l.r.opening, 0);
    for (const p of periods) {
      run += mov.filter((l) => isPL(l.cls!)).reduce((s, l) => s + (l.r.values[p] ?? 0), 0);
      if (run) re[p] = -run;
    }
    if (Object.keys(re).length) {
      result.push(sys("__re_computed", "Earnings to date (computed from P&L accounts)", "retained_earnings", re));
      issues.notes.push("Retained earnings include profit to date computed from the P&L accounts (Odoo does not close P&L accounts into equity).");
    }
    if (!mov.some((l) => l.r.opening)) issues.notes.push("Balances are built from the movements in the file. If the export does not start at the company's first entry, include opening balances (Trial Balance with an Initial Balance column) or use the live Odoo connection.");
  }

  // balance check & close-earnings
  const balanceOf = (ls: IngestLine[]) => {
    const accts: AccountLine[] = ls.filter((l) => !l.excluded && l.cls).map((l) => ({ id: l.key, code: l.code, name: l.name, cls: l.cls!, amounts: l.values }));
    const months = buildMonths(accts).filter((m) => periods.includes(m.period));
    return months.map((m) => ({ p: m.period, imb: bsCalc(m.bs).imbalance, ret: plCalc(m.pl).retained_income, hasBS: BS_KEYS.some((k) => m.bs[k]) }));
  };
  let bal = balanceOf(result);
  // does the gap look like unclosed current-year profit?
  let acc = 0, last: number | null = null, hits = 0;
  for (const b of bal) {
    const f = fyOf(b.p, opts.fyStart);
    if (f !== last) { acc = 0; last = f; }
    acc += b.ret;
    if (b.hasBS && Math.abs(b.imb - acc) <= Math.max(2, Math.abs(acc) * 0.01) && Math.abs(acc) > 1) hits++;
  }
  const unclosed = !mov.length && hits >= Math.max(2, Math.floor(bal.length / 2));
  if ((opts.closeEarnings === true || (opts.closeEarnings === "auto" && unclosed)) && bal.length) {
    const re: Record<string, number> = {};
    let a = 0, lf: number | null = null;
    for (const b of bal) { const f = fyOf(b.p, opts.fyStart); if (f !== lf) { a = 0; lf = f; } a += b.ret; if (a) re[b.p] = a; }
    result.push(sys("__close_earnings", "Current-year earnings (closed into retained earnings)", "retained_earnings", re));
    issues.notes.push("The source balance sheet excluded current-year profit; financial-year-to-date net income was added to retained earnings so the balance sheet balances.");
    bal = balanceOf(result);
  } else if (unclosed) issues.warnings.push("The balance sheet gap matches year-to-date net income in most months: current-year profit looks unclosed. Turn on 'Close current-year earnings'.");
  if (opts.plugEquity) {
    const plug: Record<string, number> = {};
    for (const b of bal) if (Math.abs(b.imb) > 0.5) plug[b.p] = b.imb;
    if (Object.keys(plug).length) {
      result.push(sys("__plug", "Balancing adjustment (plug)", "other_equity", plug));
      issues.notes.push(`The balance sheet was out of balance in ${Object.keys(plug).length} month(s); the difference was put into Other Equity. Treat balance-sheet ratios with caution until the source is fixed.`);
      bal = balanceOf(result);
    }
  }
  const bad = bal.filter((b) => b.hasBS && Math.abs(b.imb) > 2);
  if (bad.length) issues.warnings.push(`Balance sheet out of balance in ${bad.length} of ${bal.length} months (e.g. ${bad[bad.length - 1].p}: ${Math.round(bad[bad.length - 1].imb).toLocaleString("en-GB")}).`);
  if (periods.length) {
    const unm = result.filter((l) => !l.cls && !l.system).length;
    if (unm) issues.warnings.push(`${unm} line${unm > 1 ? "s are" : " is"} not mapped and will be left out until you choose a class.`);
  }

  const months = buildMonths(result.filter((l) => !l.excluded && l.cls).map((l) => ({ id: l.key, code: l.code, name: l.name, cls: l.cls!, amounts: l.values })));
  const pick = (k: "revenue" | "cash") => Object.fromEntries(months.filter((m) => periods.includes(m.period)).map((m) => [m.period, k === "revenue" ? m.pl.revenue ?? 0 : m.bs.cash ?? 0]));
  return {
    lines: result, periods,
    kind: mov.length && nat.length ? "mixed" : mov.length ? "movement" : "natural",
    detected: { ytd: decum, creditNegative, unclosedEarnings: unclosed },
    issues, imbalance: Object.fromEntries(bal.map((b) => [b.p, b.imb])),
    totals: { revenue: pick("revenue"), cash: pick("cash") },
  };
}

function sys(key: string, name: string, cls: ClassKey, values: Record<string, number>): IngestLine {
  return { key, sheet: "", row: 0, code: "", name, label: name, section: "", cls, conf: 1, why: "computed", excluded: false, system: true, values };
}

export function ingest(grids: Grid[], opts: IngestOptions): IngestResult {
  const { raw, issues } = extractAll(grids);
  return runIngest(raw, issues, opts);
}

/** Merge mapped lines into accounts for storage (same code+name+class are combined). */
export function toAccountInputs(res: IngestResult) {
  const m = new Map<string, { code: string; name: string; cls: ClassKey; amounts: Record<string, number>; confidence: number; mapped_by: "auto" | "user" | "system" }>();
  for (const l of res.lines) {
    if (l.excluded || !l.cls) continue;
    const k = `${l.code}|${l.name}|${l.cls}`;
    const cur = m.get(k) ?? { code: l.code, name: l.name, cls: l.cls, amounts: {}, confidence: l.conf, mapped_by: l.system ? "system" : l.why === "your mapping" ? "user" : "auto" };
    for (const [p, v] of Object.entries(l.values)) cur.amounts[p] = (cur.amounts[p] ?? 0) + v;
    m.set(k, cur);
  }
  return [...m.values()];
}

export const CLASS_LABEL: Record<ClassKey, string> = {
  revenue: "Revenue", cos_variable: "Cost of Sales · Variable", cos_fixed: "Cost of Sales · Fixed", cos_depreciation: "Cost of Sales · Depreciation",
  exp_variable: "Expenses · Variable", exp_fixed: "Expenses · Fixed", exp_depreciation: "Expenses · Depreciation & Amortisation",
  other_income: "Other Income", other_expenses: "Other Expenses", interest_income: "Interest Income", interest_expenses: "Interest Expenses",
  tax_expenses: "Tax Expenses", adjustments: "Adjustments", dividends: "Dividends",
  cash: "Cash & Equivalents", ar: "Accounts Receivable", inventory: "Inventory", wip: "Work In Progress", other_ca: "Other Current Assets",
  fixed_assets: "Fixed Assets", intangibles: "Intangible Assets", investments: "Investments / Other Non-Current Assets",
  std: "Short Term Debt", ap: "Accounts Payable", tax_liab: "Tax Liability", other_cl: "Other Current Liabilities",
  ltd: "Long Term Debt", other_ncl: "Other Non-Current Liabilities", retained_earnings: "Retained Earnings", other_equity: "Other Equity",
};
export const CLASS_OPTIONS = [...PL_KEYS, ...BS_KEYS] as ClassKey[];
