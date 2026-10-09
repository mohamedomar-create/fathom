import { addMonths, BS_KEYS, PL_KEYS, type ClassKey } from "@/lib/engine";
import { buildMonths, CREDIT_CLASSES, isPL, toNatural } from "@/lib/company/build";
import { bsCalc, plCalc } from "@/lib/engine";
import type { AccountLine } from "@/lib/company/types";
import { classify, CONTRA_REVENUE } from "./classify";
import { extractGrid, type ControlRow, type Grid, type Overrides, type RawLine, type SheetLayout } from "./extract";
import type { Check, ControlTotal } from "@/lib/company/checks";
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
  /** Statement the line sits in, when the file says so. */
  stmt: "PL" | "BS" | null;
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
  totals: { revenue: Record<string, number>; cash: Record<string, number>; assets: Record<string, number> };
  /** Months this file covers, per statement (an import replaces exactly these months). */
  slices: { PL: string[]; BS: string[] };
  /** P&L months whose figures cover several months (a range or year-to-date column): month → number of months. */
  ranges: Record<string, number>;
  /** Total rows printed in the file (single-month columns only), to verify the imported figures. */
  controls: ControlTotal[];
  /** File-level checks: the same account in two sheets, debits not equal to credits. */
  checks: Check[];
  layouts: SheetLayout[];
}

const COSTS = new Set<ClassKey>(["cos_variable", "cos_fixed", "cos_depreciation", "exp_variable", "exp_fixed", "exp_depreciation", "other_expenses", "interest_expenses", "tax_expenses", "adjustments", "dividends"]);
const SUBTOTAL = /^\s*(total|sub.?total|grand total|gross (profit|margin|loss)|net (income|profit|loss|earnings|sales)|operating (profit|income|loss)|ebit(da)?\b|profit (before|after)|(income|earnings) before|working capital|check|difference|balance check|الإجمالي|اجمالي|إجمالي|مجموع|صافي (الربح|الدخل|الخسارة)|مجمل (الربح|الخسارة))/i;

const monthsFrom = (a: string, b: string) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5) - +a.slice(5)) + 1;
const fyOf = (p: string, fy: number) => { const [y, m] = p.split("-").map(Number); return m >= fy ? y : y - 1; };
function continuous(ps: string[]) {
  const s = [...new Set(ps)].sort();
  if (!s.length) return [];
  const out: string[] = [];
  for (let p = s[0]; p <= s[s.length - 1]; p = addMonths(p, 1)) out.push(p);
  return out;
}

export type ExtractResult = { skippedCols: string[]; warnings: string[]; layouts?: SheetLayout[]; controls?: ControlRow[] };

export function extractAll(grids: Grid[], overrides: Overrides = {}) {
  const issues: Required<ExtractResult> = { skippedCols: [], warnings: [], layouts: [], controls: [] };
  const raw = grids.flatMap((g) => extractGrid(g, issues, overrides[g.name]));
  return { raw, issues };
}

export function runIngest(raw: RawLine[], extractIssues: ExtractResult, opts: IngestOptions): IngestResult {
  const issues = { warnings: [...extractIssues.warnings], notes: [] as string[], flips: [] as string[], subtotals: [] as string[], skippedCols: [...extractIssues.skippedCols] };
  // ---- subtotal removal (natural lines only; movement exports are per account)
  const skip = new Set<string>();
  raw.forEach((r) => {
    // Movement exports are per account, but their grand-total row ("Total") must still go.
    const isTotal = r.kind === "movement" ? !r.code && /^\s*(total|grand total|الإجمالي|الاجمالي|المجموع|إجمالي)\b/i.test(r.name) : SUBTOTAL.test(r.name);
    if (isTotal && !(r.stmt === "BS" && /^\s*net (profit|income|loss|earnings)/i.test(r.name))) {
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
  else {
    periods = continuous([...plP, ...bsP, ...movP]);
    if (plP.length && bsP.length && (plP[0] !== bsP[0] || plP.length !== bsP.length)) issues.notes.push(`The P&L covers ${plP.length} months and the balance sheet ${bsP.length}; each is imported for the months it has.`);
  }
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
    // Unmapped lines keep their file values so their size can be judged (they are never stored).
    const v = values.get(l.r.key) ?? (l.cls ? {} : l.r.values);
    const vv = Object.fromEntries(Object.entries(v).filter(([p, x]) => periods.includes(p) && x));
    return { key: l.r.key, sheet: l.r.sheet, row: l.r.row, code: l.r.code, name: l.r.name, label: l.r.label, section: l.r.section, stmt: l.r.stmt, cls: l.cls, conf: l.conf, why: l.why, excluded: l.excluded || !l.cls, system: false, values: vv };
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

  // P&L figures that cover more than one month: range columns, and the first month of a year-to-date file.
  const ranges: Record<string, number> = {};
  for (const l of [...nat, ...mov]) if (isPL(l.cls!) && l.r.spans) for (const [p, k] of Object.entries(l.r.spans)) if (periods.includes(p)) ranges[p] = Math.max(ranges[p] ?? 1, k);
  if (decum) for (const p of plP) {
    const prev = addMonths(p, -1);
    const fy0 = Number(p.slice(5)) >= opts.fyStart ? `${p.slice(0, 4)}-${String(opts.fyStart).padStart(2, "0")}` : `${Number(p.slice(0, 4)) - 1}-${String(opts.fyStart).padStart(2, "0")}`;
    if (!plP.includes(prev) || fyOf(prev, opts.fyStart) !== fyOf(p, opts.fyStart)) { const k = monthsFrom(fy0, p); if (k > 1) ranges[p] = Math.max(ranges[p] ?? 1, k); }
  }
  if (Object.keys(ranges).length) issues.notes.push(`Some P&L columns cover several months (${Object.entries(ranges).map(([p, k]) => `${p}: ${k} months`).join(", ")}). Each is turned into its last month by subtracting the months already loaded; if they are not loaded, the import asks what to do.`);

  // Total rows from the file. P&L totals only verify single-month columns (year-to-date totals are converted like the lines).
  const controls: ControlTotal[] = [];
  // A total row that is zero in every month is a placeholder (a heading or an empty formula), not a figure to check against.
  const ctl = (extractIssues.controls ?? []).filter((c, _, all) => all.some((x) => x.metric === c.metric && x.source.split(" row ")[0] === c.source.split(" row ")[0] && Math.abs(x.value) > 0.005));
  for (const c of ctl) {
    if (!periods.includes(c.period)) continue;
    const pl = c.metric === "net_income" || c.metric === "gross_profit";
    if (pl && (c.months > 1 || ranges[c.period])) continue;
    let value = c.value;
    if (pl && decum) {
      const prev = addMonths(c.period, -1);
      const before = ctl.find((x) => x.metric === c.metric && x.period === prev);
      if (fyOf(prev, opts.fyStart) === fyOf(c.period, opts.fyStart)) { if (!before) continue; value -= before.value; }
    }
    controls.push({ metric: c.metric, period: c.period, value, source: c.source });
  }

  // The same account read from two sheets would be counted twice (e.g. a Trial Balance and a P&L in one workbook).
  const fileChecks: Check[] = [];
  const seen = new Map<string, { bySheet: Map<string, Set<string>>; name: string; stmt: "PL" | "BS" }>();
  for (const l of result) {
    if (l.excluded || !l.cls || l.system) continue;
    const stmt = isPL(l.cls) ? "PL" : "BS";
    const id = l.code ? `c:${l.code.toLowerCase()}` : `n:${stmt}:${normLabel(l.name)}`;
    const e = seen.get(id) ?? { bySheet: new Map<string, Set<string>>(), name: l.name, stmt };
    const ps = e.bySheet.get(l.sheet) ?? new Set<string>();
    for (const p of Object.keys(l.values)) ps.add(p);
    e.bySheet.set(l.sheet, ps);
    seen.set(id, e);
  }
  const dups = [...seen.values()].map((e) => {
    const sheets = [...e.bySheet.entries()];
    const clash = sheets.filter(([sh, ps]) => sheets.some(([sh2, ps2]) => sh2 !== sh && [...ps].some((p) => ps2.has(p)))).map(([sh]) => sh);
    return { ...e, clash };
  }).filter((e) => e.clash.length > 1);
  for (const st of ["PL", "BS"] as const) {
    const ds = dups.filter((d) => d.stmt === st);
    if (!ds.length) continue;
    const sheets = [...new Set(ds.flatMap((d) => d.clash))];
    fileChecks.push({ id: "duplicate", severity: "block", statement: st, title: `${ds.length} account${ds.length > 1 ? "s appear" : " appears"} in more than one sheet`, detail: `${ds.slice(0, 3).map((d) => `'${d.name}'`).join(", ")}${ds.length > 3 ? "…" : ""} ${ds.length > 1 ? "are" : "is"} in ${sheets.map((x) => `'${x}'`).join(" and ")}, so ${ds.length > 1 ? "they" : "it"} would be counted twice. Leave out one of the sheets under "How the file was read".` });
  }

  // Trial balances, ledgers and journals: debits must equal credits.
  if (mov.length) {
    const allMov = used.filter((r) => r.kind === "movement");
    const big = Math.max(1, ...allMov.flatMap((r) => [Math.abs(r.opening), ...Object.values(r.values).map(Math.abs)]));
    const tol = Math.max(1, big * 1e-6);
    const off: string[] = [];
    const open = allMov.reduce((a, r) => a + r.opening, 0);
    if (Math.abs(open) > tol) off.push(`opening balances ${Math.round(open).toLocaleString("en-GB")}`);
    for (const p of periods) { const t = allMov.reduce((a, r) => a + (r.values[p] ?? 0), 0); if (Math.abs(t) > tol) off.push(`${p} ${Math.round(t).toLocaleString("en-GB")}`); }
    if (off.length) fileChecks.push({ id: "tb_zero", severity: "block", title: "Debits do not equal credits", detail: `The movements in the file do not net to zero (${off.slice(0, 4).join("; ")}${off.length > 4 ? "…" : ""}). The export is probably filtered to some accounts or journals, or rows are missing. Export all accounts, posted entries only.` });
  }

  const months = buildMonths(result.filter((l) => !l.excluded && l.cls).map((l) => ({ id: l.key, code: l.code, name: l.name, cls: l.cls!, amounts: l.values })));
  const pick = (k: "revenue" | "cash" | "assets") => Object.fromEntries(months.filter((m) => periods.includes(m.period)).map((m) => [m.period, k === "revenue" ? m.pl.revenue ?? 0 : k === "cash" ? m.bs.cash ?? 0 : bsCalc(m.bs).ta]));
  const movPL = mov.some((l) => isPL(l.cls!)), movBS = mov.length > 0;
  return {
    lines: result, periods,
    kind: mov.length && nat.length ? "mixed" : mov.length ? "movement" : "natural",
    detected: { ytd: decum, creditNegative, unclosedEarnings: unclosed },
    issues, imbalance: Object.fromEntries(bal.map((b) => [b.p, b.imb])),
    totals: { revenue: pick("revenue"), cash: pick("cash"), assets: pick("assets") },
    slices: {
      PL: [...new Set([...plP, ...(movPL ? movP : [])])].filter((p) => periods.includes(p)).sort(),
      BS: [...new Set([...bsP, ...(movBS ? movP : [])])].filter((p) => periods.includes(p)).sort(),
    },
    ranges, controls, checks: fileChecks, layouts: extractIssues.layouts ?? [],
  };
}

function sys(key: string, name: string, cls: ClassKey, values: Record<string, number>): IngestLine {
  return { key, sheet: "", row: 0, code: "", name, label: name, section: "", stmt: "BS", cls, conf: 1, why: "computed", excluded: false, system: true, values };
}

export function ingest(grids: Grid[], opts: IngestOptions, overrides: Overrides = {}): IngestResult {
  const { raw, issues } = extractAll(grids, overrides);
  return runIngest(raw, issues, opts);
}

/** Merge mapped lines into accounts for storage (same code+name+class are combined). */
export function toAccountInputs(res: IngestResult) {
  const m = new Map<string, { code: string; name: string; cls: ClassKey; amounts: Record<string, number>; confidence: number; mapped_by: "auto" | "user" | "system"; ref?: { sheet: string; row: number; label: string } }>();
  for (const l of res.lines) {
    if (l.excluded || !l.cls) continue;
    const k = `${l.code}|${l.name}|${l.cls}`;
    const cur = m.get(k) ?? { code: l.code.slice(0, 40), name: (l.name || l.label || l.code || "Unnamed account").slice(0, 300), cls: l.cls, amounts: {}, confidence: l.conf, mapped_by: l.system ? "system" : l.why === "your mapping" ? "user" : "auto",
      ref: l.system ? undefined : { sheet: l.sheet.slice(0, 120), row: l.row, label: l.label.slice(0, 300) } };
    for (const [p, v] of Object.entries(l.values)) cur.amounts[p] = (cur.amounts[p] ?? 0) + v;
    m.set(k, cur);
  }
  // Round to cents and drop zero months: keeps the payload small and the stored data clean.
  for (const a of m.values()) a.amounts = Object.fromEntries(Object.entries(a.amounts).map(([p, v]) => [p, Math.round(v * 100) / 100] as const).filter(([, v]) => v !== 0));
  return [...m.values()].filter((a) => Object.keys(a.amounts).length > 0);
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

/** Unmapped lines large enough to distort the statements (0.5% of revenue or total assets): they block the import until mapped, excluded or accepted. */
export function materialUnmapped(res: IngestResult) {
  const scale = (o: Record<string, number>) => Math.max(0, ...Object.values(o).map(Math.abs));
  const limit = Math.max(1, 0.005 * Math.max(scale(res.totals.revenue), scale(res.totals.assets)));
  return res.lines.filter((l) => !l.cls && !l.system && l.why !== "excluded by you" && Math.max(0, ...Object.values(l.values).map(Math.abs)) > limit);
}
