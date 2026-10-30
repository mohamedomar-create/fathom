import { balanced } from "@/lib/tolerance";
import { addMonths } from "./format";
import { bsCalc, plCalc } from "./statements";
import { hasBS, hasPL, type BSCalc, type ClassKey, type MonthData, type PLCalc, type SubKey } from "./types";

type Amounts<K extends string> = Partial<Record<K, number>>;
/**
 * The sub-classed amounts a cash flow needs: P&L ones over the period (disposal gains, unrealised exchange, right-of-use
 * depreciation) and balance-sheet ones at both ends, with how much of each class they hold.
 */
export interface CFSub { p: Amounts<SubKey>; b: Amounts<SubKey>; b0: Amounts<SubKey>; of: Amounts<ClassKey>; of0: Amounts<ClassKey> }

/** The sub-classed amounts for a window's months, its closing month and the month before it; undefined when there are none. */
export function cfSubOf(window: MonthData[], end: MonthData | null | undefined, open: MonthData | null | undefined): CFSub | undefined {
  const p: Amounts<SubKey> = {};
  for (const m of window) for (const k of ["disposal_gain", "fx_unrealised", "rou_depreciation"] as const) if (m.sub?.[k]) p[k] = (p[k] ?? 0) + m.sub[k]!;
  const out: CFSub = { p, b: end?.sub ?? {}, b0: open?.sub ?? {}, of: end?.subOf ?? {}, of0: open?.subOf ?? {} };
  return Object.keys(p).length || Object.keys(out.b).length || Object.keys(out.b0).length ? out : undefined;
}

const NONE: CFSub = { p: {}, b: {}, b0: {}, of: {}, of0: {} };

/** Two periods' sub-classes with the same keys (0 where one has none), so their statements list the same lines. */
export function alignSubs(a: CFSub | undefined, b: CFSub | undefined): [CFSub | undefined, CFSub | undefined] {
  if (!a && !b) return [a, b];
  const A = a ?? NONE, B = b ?? NONE;
  const keys = (x: object, y: object) => [...new Set([...Object.keys(x), ...Object.keys(y)])];
  const fill = <T extends Record<string, number | undefined>>(x: T, k: string[]) => Object.fromEntries(k.map((key) => [key, x[key] ?? 0])) as T;
  const kp = keys(A.p, B.p), kb = keys({ ...A.b, ...A.b0 }, { ...B.b, ...B.b0 });
  const one = (x: CFSub): CFSub => ({ p: fill(x.p, kp), b: fill(x.b, kb), b0: fill(x.b0, kb), of: x.of, of0: x.of0 });
  return [one(A), one(B)];
}

/** The movements both cash flow views are built from, sub-classes taken into account (IAS 7). */
function movements(P: PLCalc, B: BSCalc, B0: BSCalc, sub: CFSub = NONE) {
  const d = (k: keyof BSCalc) => (B[k] as number) - (B0[k] as number);
  const has = (k: SubKey) => k in sub.b || k in sub.b0;
  const ds = (k: SubKey) => (sub.b[k] ?? 0) - (sub.b0[k] ?? 0);
  // A class's change without its sub-classed accounts, which are shown on their own lines.
  const dx = (c: ClassKey & keyof BSCalc) => d(c) - ((sub.of[c] ?? 0) - (sub.of0[c] ?? 0));
  const gain = sub.p.disposal_gain ?? 0, fx = sub.p.fx_unrealised ?? 0, rouDep = sub.p.rou_depreciation ?? 0;
  // A line shows when its kind of account is marked, even at nil, so two periods line up.
  const hasGain = "disposal_gain" in sub.p, hasFx = "fx_unrealised" in sub.p;
  const lease = has("lease_liability") || has("rou_asset");
  const estimated: string[] = [];
  if (!has("interest_payable") && P.interest_expenses) estimated.push("Interest paid is the interest charge: no interest payable account is marked.");
  if (!has("dividends_payable") && P.dividends) estimated.push("Dividends paid are the dividends declared: no dividends payable account is marked.");
  if (!has("income_tax_payable") && P.tax_expenses) estimated.push("Income tax paid is not separated from VAT and payroll taxes: no income tax payable account is marked.");
  return {
    d, dx, gain, fx, hasGain, hasFx, estimated,
    interest: { label: has("interest_payable") ? "Interest paid (net of interest received)" : P.net_interest < 0 ? "Net Interest Received" : "Net Interest Paid", value: -P.net_interest + ds("interest_payable") },
    dividends: { label: has("dividends_payable") ? "Dividends paid" : "Dividends", value: -P.dividends + ds("dividends_payable") },
    tax: has("income_tax_payable") ? { paid: -(P.tax_expenses - ds("income_tax_payable")), other: dx("tax_liab") } : null,
    nonCash: { provisions: has("provisions") || has("end_of_service") ? ds("provisions") + ds("end_of_service") : null, deferred: has("deferred_tax") ? ds("deferred_tax") : null },
    capex: { label: hasGain ? "Purchase / Sale of Fixed Assets (net of disposal proceeds)" : "Purchase / Sale of Fixed Assets", value: -(dx("fixed_assets") + P.da - rouDep) + gain },
    lease: lease ? ds("lease_liability") - (ds("rou_asset") + rouDep) : null,
    equity: d("other_equity") + d("retained_earnings") - P.retained_income,
  };
}

export type WaterfallSign = "ADD" | "LESS" | "TOTAL";
export interface WaterfallRow {
  label: string;
  sign: WaterfallSign;
  value: number;
  info?: string;
}
export interface Waterfall {
  rows: WaterfallRow[];
  ocf: number; fcf: number; ncf: number;
  /** Movement the statements cannot explain (an unbalanced balance sheet or an unmapped account); 0 when they reconcile. */
  unreconciled: number;
  dcash: number; ddebt: number; cash0: number; cash1: number; debt0: number; debt1: number;
}

/**
 * Cash-flow waterfall built from P&L and balance-sheet movements. It follows IAS 7 with interest paid classified under
 * financing (IAS 7.33 allows this), so its operating cash flow is the same figure as the cash flow statement's.
 */
export function cashWaterfall(P: PLCalc, B: BSCalc, B0: BSCalc, sub?: CFSub): Waterfall {
  const M = movements(P, B, B0, sub);
  const { d, dx } = M;
  const rows: WaterfallRow[] = [];
  const add = (label: string, sign: WaterfallSign, value: number, info?: string) => rows.push({ label, sign, value, info });
  add("Revenue", "ADD", P.revenue);
  add("Cost of Sales", "LESS", -(P.cos - P.cos_depreciation), "Cost of sales excluding depreciation (a non-cash cost).");
  add("Expenses", "LESS", -(P.expenses - P.exp_depreciation + P.other_expenses), "Operating and other expenses excluding depreciation & amortisation.");
  add("Other Income", "ADD", P.other_income);
  if (M.hasGain) add("Less gain or loss on disposal (in investing)", "LESS", -M.gain, "A disposal's cash is its sale price, shown under investing.");
  if (M.hasFx) add("Less unrealised exchange differences", "LESS", -M.fx, "A revaluation moves no cash.");
  if (M.tax) {
    add("Income tax paid", "LESS", M.tax.paid, "Income tax charged less the increase in income tax owed.");
    add("Change in VAT and other taxes owed", "ADD", M.tax.other);
  } else add("Tax paid, net of the change in tax owed (incl. VAT)", "LESS", -(P.tax_expenses - d("tax_liab")), "Tax expense less the increase in tax owed, VAT included (or plus the decrease): positive when more tax was charged or collected than paid.");
  if (P.adjustments) add("Adjustments", "LESS", -P.adjustments, "Prior-period and one-off items booked in the P&L.");
  if (M.nonCash.provisions !== null) add("Provisions and end-of-service benefits (non-cash)", "ADD", M.nonCash.provisions);
  if (M.nonCash.deferred !== null) add("Deferred tax (non-cash)", "ADD", M.nonCash.deferred);
  add("Change in Accounts Payable", "ADD", dx("ap"));
  add("Change in Other Current Liabilities", "ADD", dx("other_cl"));
  add("Change in Accounts Receivable", "LESS", -d("ar"));
  add("Change in Inventory", "LESS", -d("inventory"));
  add("Change in Work In Progress", "LESS", -d("wip"));
  add("Change in Other Current Assets", "LESS", -d("other_ca"));
  const ocf = rows.reduce((s, r) => s + r.value, 0);
  add("OPERATING CASH FLOW", "TOTAL", ocf, "Cash generated by trading, after tax and before interest. Interest is shown under financing.");
  const inv: WaterfallRow[] = [
    { label: M.capex.label, sign: "LESS", value: M.capex.value, info: "Change in fixed assets plus the depreciation charged: what was spent on assets, net of disposals." },
    { label: "Change in Intangible Assets", sign: "LESS", value: -d("intangibles") },
    { label: "Change in Investments or Other Non-Current Assets", sign: "LESS", value: -d("investments") },
  ];
  rows.push(...inv);
  const fcf = ocf + inv.reduce((s, r) => s + r.value, 0);
  add("FREE CASH FLOW", "TOTAL", fcf, "Operating cash flow less investment: cash available to pay lenders and owners.");
  const fin: WaterfallRow[] = [
    { label: M.interest.label, sign: "LESS", value: M.interest.value, info: M.interest.label.startsWith("Interest paid") ? "Interest expense less interest income, less any increase in interest owed." : "Interest expense less interest income." },
    { label: "Change in Other Non-Current Liabilities", sign: "ADD", value: dx("other_ncl") },
    { label: M.dividends.label, sign: "LESS", value: M.dividends.value },
    ...(M.lease !== null ? [{ label: "Lease payments (principal)", sign: "LESS" as const, value: M.lease, info: "The change in the lease liability less new right-of-use assets: what was paid off the leases." }] : []),
    { label: "Owners' Capital and Other Equity Movements", sign: "ADD", value: M.equity, info: "Capital paid in or withdrawn, and equity movements that did not come from this period's profit." },
  ];
  rows.push(...fin);
  const fxIn = M.hasFx ? [{ label: "Effect of exchange rates on cash", sign: "ADD" as const, value: M.fx }] : [];
  rows.push(...fxIn);
  const ncfPre = fcf + [...fin, ...fxIn].reduce((s, r) => s + r.value, 0);
  const target = d("cash") - dx("std") - dx("ltd");
  const unbal = target - ncfPre;
  if (!balanced(unbal)) add("Unreconciled Difference", "ADD", unbal, "The balance sheet does not balance in one of the two months, so this amount cannot be explained.");
  const ncf = ncfPre + (Math.abs(unbal) > 0.5 ? unbal : 0);
  // Each line reads as its cash effect: cash in is ADD, cash out is LESS, whatever the line usually does.
  for (const r of rows) if (r.sign !== "TOTAL") r.sign = r.value < 0 ? "LESS" : "ADD";
  add("CASH FLOW BEFORE BORROWING", "TOTAL", ncf, "Change in cash less change in borrowing: the cash the business made or used before new loans and repayments.");
  return {
    rows, ocf, fcf, ncf, unreconciled: Math.abs(unbal) > 0.5 ? unbal : 0,
    dcash: d("cash"), ddebt: d("std") + d("ltd"),
    cash0: B0.cash, cash1: B.cash, debt0: B0.std + B0.ltd, debt1: B.std + B.ltd,
  };
}

export interface StatementLine { label: string; value: number; total?: boolean; heading?: boolean }

/**
 * Indirect cash-flow statement (IAS 7), interest paid under financing. Reconciles to the change in cash. With sub-classed
 * accounts it shows what was paid (interest, dividends, income tax), moves disposals to investing and leases to
 * financing; without them the lines it cannot separate are listed in `estimated`.
 */
export function cashFlowStatement(P: PLCalc, B: BSCalc, B0: BSCalc, opts: { showUnreconciled?: boolean; sub?: CFSub } = {}): { lines: StatementLine[]; cfo: number; cfi: number; cff: number; fx: number; unreconciled: number; dcash: number; estimated: string[] } {
  const M = movements(P, B, B0, opts.sub);
  const { d, dx } = M;
  const op: [string, number][] = [
    ["Net Income", P.net_income],
    ["Add back Net Interest (shown under financing)", P.net_interest],
    ["Depreciation & Amortisation", P.da],
    ...(M.hasGain ? [["Less gain or loss on disposal (in investing)", -M.gain] as [string, number]] : []),
    ...(M.hasFx ? [["Less unrealised exchange differences (shown below)", -M.fx] as [string, number]] : []),
    ...(M.nonCash.provisions !== null ? [["Provisions and end-of-service benefits (non-cash)", M.nonCash.provisions] as [string, number]] : []),
    ...(M.nonCash.deferred !== null ? [["Deferred tax (non-cash)", M.nonCash.deferred] as [string, number]] : []),
    ...(M.tax
      ? [["Add back income tax charge", P.tax_expenses], ["Income tax paid", M.tax.paid], ["Change in VAT and other taxes owed", M.tax.other]] as [string, number][]
      : [["Change in Tax Liability", d("tax_liab")]] as [string, number][]),
    ["Change in Accounts Payable", dx("ap")],
    ["Change in Other Current Liabilities", dx("other_cl")],
    ["Change in Accounts Receivable", -d("ar")],
    ["Change in Inventory", -d("inventory")],
    ["Change in Work In Progress", -d("wip")],
    ["Change in Other Current Assets", -d("other_ca")],
  ];
  const cfo = op.reduce((s, [, v]) => s + v, 0);
  const iv: [string, number][] = [
    [M.capex.label, M.capex.value],
    ["Change in Intangible Assets", -d("intangibles")],
    ["Change in Investments / Other Non-Current Assets", -d("investments")],
  ];
  const cfi = iv.reduce((s, [, v]) => s + v, 0);
  const fn: [string, number][] = [
    [M.interest.label, M.interest.value],
    [M.dividends.label === "Dividends paid" ? "Dividends paid" : "Dividends Paid", M.dividends.value],
    ...(M.lease !== null ? [["Lease payments (principal)", M.lease] as [string, number]] : []),
    ["Owners' Capital and Other Equity Movements", M.equity],
    ["Change in Short Term Debt", dx("std")],
    ["Change in Long Term Debt", dx("ltd")],
    ["Change in Other Non-Current Liabilities", dx("other_ncl")],
  ];
  const cff = fn.reduce((s, [, v]) => s + v, 0);
  const fx = M.fx;
  // Whatever the movements cannot explain is shown on its own line, never folded into financing.
  const gap = d("cash") - (cfo + cfi + cff + fx);
  const unreconciled = balanced(gap) ? 0 : gap;
  const lines: StatementLine[] = [
    { label: "OPERATING ACTIVITIES", value: 0, heading: true },
    ...op.map(([label, value]) => ({ label, value })),
    { label: "Cash Flow from Operating Activities", value: cfo, total: true },
    { label: "INVESTING ACTIVITIES", value: 0, heading: true },
    ...iv.map(([label, value]) => ({ label, value })),
    { label: "Cash Flow from Investing Activities", value: cfi, total: true },
    { label: "FINANCING ACTIVITIES", value: 0, heading: true },
    ...fn.map(([label, value]) => ({ label, value })),
    { label: "Cash Flow from Financing Activities", value: cff, total: true },
    ...(M.hasFx ? [{ label: "Effect of exchange rates on cash", value: fx }] : []),
    ...(unreconciled || opts.showUnreconciled ? [{ label: "Unreconciled Difference (balance sheet out of balance)", value: unreconciled }] : []),
    { label: "Change in Cash & Equivalents", value: cfo + cfi + cff + fx + unreconciled, total: true },
    { label: "Opening Balance", value: B0.cash },
    { label: "Closing Balance", value: B0.cash + cfo + cfi + cff + fx + unreconciled, total: true },
  ];
  return { lines, cfo, cfi, cff, fx, unreconciled, dcash: d("cash"), estimated: M.estimated };
}

export interface MonthCash { period: string; cfo: number; cfi: number; cff: number; unreconciled: number; dcash: number; cash: number }

/**
 * The cash flow statement month by month for the periods asked for. A month is left out when its P&L or balance sheet,
 * or the balance sheet of the month before, is not loaded: a missing month never reads as zero activity.
 */
export function cashFlowByMonth(months: MonthData[], periods: string[]): { rows: MonthCash[]; skipped: string[] } {
  const by = new Map(months.map((m) => [m.period, m]));
  const rows: MonthCash[] = [], skipped: string[] = [];
  for (const p of periods) {
    const m = by.get(p), before = by.get(addMonths(p, -1));
    if (!m || !hasPL(m) || !hasBS(m) || !before || !hasBS(before)) { skipped.push(p); continue; }
    const B = bsCalc(m.bs);
    const cf = cashFlowStatement(plCalc(m.pl), B, bsCalc(before.bs), { sub: cfSubOf([m], m, before) });
    rows.push({ period: p, cfo: cf.cfo, cfi: cf.cfi, cff: cf.cff, unreconciled: cf.unreconciled, dcash: cf.dcash, cash: B.cash });
  }
  return { rows, skipped };
}
