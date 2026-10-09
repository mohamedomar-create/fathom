// Synthetic Odoo-style exports built from the sample company, so the expected class totals are known exactly.
import sample from "../../reference/sample.json";
import { spreadAccounts } from "@/lib/company/demo";
import { isPL, toRaw } from "@/lib/company/build";
import { plCalc, type MonthData } from "@/lib/engine";
import type { Grid } from "@/lib/ingest/extract";
import type { Cell } from "@/lib/ingest/parse";

export const months = sample.months as MonthData[];
export const accounts = spreadAccounts(months);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lab = (p: string) => `${MON[+p.slice(5) - 1]} ${p.slice(0, 4)}`;

const PL_GROUPS: [string, string[]][] = [
  ["Income", ["revenue"]],
  ["Cost of Revenue", ["cos_variable", "cos_fixed", "cos_depreciation"]],
  ["Expenses", ["exp_variable", "exp_fixed", "exp_depreciation"]],
  ["Other Income", ["other_income", "interest_income"]],
  ["Other Expenses", ["other_expenses", "interest_expenses", "tax_expenses"]],
];
const BS_GROUPS: [string, string[]][] = [
  ["ASSETS", []], ["Current Assets", ["cash", "ar", "inventory", "other_ca"]], ["Fixed Assets", ["fixed_assets"]],
  ["LIABILITIES", []], ["Current Liabilities", ["std", "ap", "tax_liab", "other_cl"]],
  ["EQUITY", ["retained_earnings", "other_equity"]],
];

/** Odoo "Profit and Loss" / "Balance Sheet" with monthly comparison columns (natural signs, headings, subtotals). */
export function odooReports(opts: { ytd?: boolean; arabicHeadings?: boolean; unclosed?: boolean } = {}): Grid[] {
  const ps = months.map((m) => m.period);
  const plRows: Cell[][] = [["Profit and Loss"], [""], ["", ...ps.map(lab)]];
  for (const [g, classes] of PL_GROUPS) {
    plRows.push([opts.arabicHeadings && g === "Expenses" ? "المصروفات" : g]);
    const accs = accounts.filter((a) => classes.includes(a.cls));
    for (const a of accs) plRows.push([`${a.code} ${a.name}`, ...ps.map((p, i) => {
      if (!opts.ytd) return a.amounts[p] ?? 0;
      const y = p.slice(0, 4);
      return ps.slice(0, i + 1).filter((q) => q.slice(0, 4) === y).reduce((s, q) => s + (a.amounts[q] ?? 0), 0);
    })]);
    plRows.push([`Total ${g}`, ...ps.map((p) => accs.reduce((s, a) => s + (a.amounts[p] ?? 0), 0))]);
  }
  const ni = (p: string) => plCalc(months.find((m) => m.period === p)!.pl).net_income;
  plRows.push(["Net Profit", ...ps.map((p, i) => (opts.ytd ? ps.slice(0, i + 1).filter((q) => q.slice(0, 4) === p.slice(0, 4)).reduce((s, q) => s + ni(q), 0) : ni(p)))]);
  const fyNI = (p: string) => months.filter((m) => m.period.slice(0, 4) === p.slice(0, 4) && m.period <= p).reduce((s, m) => {
    const q = m.pl as Record<string, number>;
    return s + q.revenue - q.cos_variable - q.cos_depreciation - q.exp_variable - q.exp_fixed + q.other_income - q.other_expenses + q.interest_income - q.interest_expenses - q.tax_expenses;
  }, 0);
  const bsRows: Cell[][] = [["Balance Sheet"], ["", ...ps.map(lab)]];
  for (const [g, classes] of BS_GROUPS) {
    bsRows.push([g]);
    for (const a of accounts.filter((x) => classes.includes(x.cls)))
      bsRows.push([`${a.code} ${a.name}`, ...ps.map((p) => (a.amounts[p] ?? 0) - (opts.unclosed && a.cls === "retained_earnings" ? fyNI(p) : 0))]);
  }
  return [{ name: "Profit and Loss", rows: plRows }, { name: "Balance Sheet", rows: bsRows }];
}

/** Single-sheet trial balance where credits are negative (no headings). */
export function trialBalanceSigned(): Grid[] {
  const ps = months.map((m) => m.period);
  const rows: Cell[][] = [["Account", ...ps]];
  for (const a of accounts) rows.push([`${a.code} ${a.name}`, ...ps.map((p) => toRaw(a.cls, a.amounts[p] ?? 0))]);
  return [{ name: "TB", rows }];
}

/** Odoo journal items export (long format, debit/credit), double-entry balanced. Opening entry on the first day. */
export function journalItems(): Grid[] {
  const rows: Cell[][] = [["Date", "Journal Entry", "Account", "Partner", "Label", "Debit", "Credit"]];
  const ps = months.map((m) => m.period);
  const first = ps[0];
  // Opening balances = closing BS of the month before the first: back out the first month's movement.
  // Simpler: post the first month's closing BS for BS accounts, and P&L movements for the first month, balanced via opening equity.
  let n = 1;
  const post = (date: string, acc: string, raw: number) => {
    if (!raw) return;
    rows.push([date, `MISC/${n++}`, acc, "", "", raw > 0 ? raw : 0, raw < 0 ? -raw : 0]);
  };
  for (const p of ps) {
    const date = `${p}-15`;
    let check = 0;
    for (const a of accounts) {
      const prev = ps.indexOf(p) > 0 ? a.amounts[ps[ps.indexOf(p) - 1]] ?? 0 : 0;
      const nat = isPL(a.cls) ? a.amounts[p] ?? 0 : (a.amounts[p] ?? 0) - prev;
      if (a.cls === "retained_earnings" || a.cls === "other_equity") continue; // RE is computed from P&L; equity is the balancing leg
      const raw = toRaw(a.cls, nat);
      post(date, `${a.code} ${a.name}`, raw);
      check += raw;
    }
    // balance the entry through share capital (first month) or partners' account
    post(date, p === first ? "300000 Share Capital" : "301000 Partners' Current Account", -check);
  }
  return [{ name: "Journal Items", rows }];
}

/** Odoo Trial Balance with monthly comparison: each month has Debit / Credit columns, plus Initial Balance. */
export function trialBalanceDebitCredit(): Grid[] {
  const ps = months.slice(1).map((m) => m.period);
  const openP = months[0].period;
  const h1: Cell[] = ["", "Initial Balance", null], h2: Cell[] = ["Account", "Debit", "Credit"];
  for (const p of ps) { h1.push(lab(p), null); h2.push("Debit", "Credit"); }
  const rows: Cell[][] = [["Trial Balance"], h1, h2];
  // Odoo keeps earnings in the P&L accounts; prior earnings sit in the undistributed profits account.
  const re0 = toRaw("retained_earnings", months[0].bs.retained_earnings ?? 0);
  rows.push(["999999 Undistributed Profits/Losses", re0 > 0 ? re0 : 0, re0 < 0 ? -re0 : 0, ...ps.flatMap(() => [0, 0])]);
  for (const a of accounts) {
    if (a.cls === "retained_earnings") continue;
    const open = isPL(a.cls) ? 0 : toRaw(a.cls, a.amounts[openP] ?? 0);
    const r: Cell[] = [`${a.code} ${a.name}`, open > 0 ? open : 0, open < 0 ? -open : 0];
    ps.forEach((p, i) => {
      const prev = i === 0 ? openP : ps[i - 1];
      const mv = toRaw(a.cls, isPL(a.cls) ? a.amounts[p] ?? 0 : (a.amounts[p] ?? 0) - (a.amounts[prev] ?? 0));
      r.push(mv > 0 ? mv : 0, mv < 0 ? -mv : 0);
    });
    rows.push(r);
  }
  return [{ name: "Trial Balance", rows }];
}

/** Odoo General Ledger export: account headings, an Initial Balance row, then dated move lines (no account column). */
export function generalLedger(): Grid[] {
  const [h1, h2, ...body] = trialBalanceDebitCredit()[0].rows.slice(1);
  const periods = (h1.filter((x) => x && x !== "Initial Balance") as string[]);
  void h2;
  const rows: Cell[][] = [["My Company"], ["General Ledger"], [], ["", "Date", "Communication", "Partner", "Currency", "Debit", "Credit", "Balance"]];
  const iso = (label: string) => { const [m, y] = label.split(" "); return new Date(`${y}-${String(MON.indexOf(m) + 1).padStart(2, "0")}-28T00:00:00`); };
  let n = 1;
  for (const r of body) {
    const [acc, od, oc, ...mv] = r as [string, number, number, ...number[]];
    rows.push([acc, null, null, null, null, null, null, null]);
    if (od || oc) rows.push(["Initial Balance", null, null, null, null, od, oc, od - oc]);
    periods.forEach((p, i) => {
      const d = mv[i * 2], c = mv[i * 2 + 1];
      if (d || c) rows.push([`MISC/${n++}`, iso(p), "Monthly posting", "", "", d, c, null]);
    });
  }
  rows.push(["Total", null, null, null, null, 0, 0, 0]);
  return [{ name: "General Ledger", rows }];
}

/** Odoo Trial Balance for a single month without comparison: the column header is a date range. */
export function trialBalanceSinglePeriod(index = 1): Grid[] {
  const p = months[index].period, prev = months[index - 1].period;
  const last = new Date(+p.slice(0, 4), +p.slice(5), 0).getDate();
  const range = `From 01/${p.slice(5)}/${p.slice(0, 4)} to ${last}/${p.slice(5)}/${p.slice(0, 4)}`;
  const rows: Cell[][] = [["My Company"], ["Trial Balance"], ["", "Initial Balance", null, range, null, "End Balance", null], ["", "Debit", "Credit", "Debit", "Credit", "Debit", "Credit"]];
  const dc = (v: number): [number, number] => [v > 0 ? v : 0, v < 0 ? -v : 0];
  const re0 = toRaw("retained_earnings", months[index - 1].bs.retained_earnings ?? 0);
  rows.push(["999999 Undistributed Profits/Losses", ...dc(re0), 0, 0, ...dc(re0)]);
  for (const a of accounts) {
    if (a.cls === "retained_earnings") continue;
    const open = isPL(a.cls) ? 0 : toRaw(a.cls, a.amounts[prev] ?? 0);
    const mv = toRaw(a.cls, isPL(a.cls) ? a.amounts[p] ?? 0 : (a.amounts[p] ?? 0) - (a.amounts[prev] ?? 0));
    rows.push([`${a.code} ${a.name}`, ...dc(open), ...dc(mv), ...dc(open + mv)]);
  }
  rows.push(["Total", 0, 0, 0, 0, 0, 0]);
  return [{ name: "Trial Balance", rows }];
}
