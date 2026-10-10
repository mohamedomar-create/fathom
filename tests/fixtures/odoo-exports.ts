// Synthetic Odoo 17/18 exports (General Ledger, Trial Balance, Profit and Loss) with the quirks of a real Egyptian
// company's files: US month-first dates, a custom chart (1 assets … 5 all expenses, no 6xxx), hierarchical groups,
// "(No Group)" accounts, code-less accounts, same-name accounts, an account without an "Initial Balance" row,
// exchange gains printed under Revenue, a future-dated entry and a report that stops on 10 October.
import type { ClassKey } from "@/lib/engine";
import type { Grid } from "@/lib/ingest/extract";
import type { Cell } from "@/lib/ingest/parse";

export interface Acct { code: string; name: string; group: string; cls: ClassKey | null }
const A = (code: string, name: string, group: string, cls: ClassKey | null): Acct => ({ code, name, group, cls });

/** Group headings: code → label (Odoo prints them in the name column, code and name together). */
export const GROUPS: [string, string][] = [
  ["1", "1 Assets"], ["11", "11 Fixed Assets"], ["111", "111 Property Planet & Equipment"], ["12", "12 Current Assets"],
  ["121", "121 Cash & Cash Equivalent"], ["1211", "1211 Cash IN Safe"], ["1212", "1212 Bank "], ["122", "122 Recevable"],
  ["2", "2 Liabilities"], ["21", "21 Current Liabilities"], ["211", "211 Payable"], ["2115", "2115 Loans & Over Draft"],
  ["3", "3 Owners Equity"], ["4", "4 Reveneus"], ["5", "5 Expenses"], ["51", "51 Cost Of Good Sold"], ["52", "52 General & Adminstration Cost"],
  ["521", "521 Employee Cost"], ["522", "522 Adminstration Cost"], ["53", "53 Sales & Markting Cost"], ["531", "531 Sales Expenses"],
  ["54", "54 Depreciaction"], ["55", "55 Financing Interest"],
];

export const ACCOUNTS: Acct[] = [
  A("1015019", "Outstanding Receipts", "1", "other_ca"),
  A("1015021", "Outstanding Receipts", "1", "other_ca"),
  A("111201", "Assets - Lap Tops", "111", "fixed_assets"),
  A("111202", "Acc. Depreciation - Lap Tops", "111", "fixed_assets"),
  A("121101", "Main Cash Safe ( Karim Adel )", "1211", "cash"),
  A("121102", "petty Omar Fathy", "1211", "cash"),
  A("121103", "Sameh Nabil", "1211", "cash"),
  A("121104", "Tarek Lotfy", "1211", "cash"),
  A("121221", "CIB Bank EGP Acc# 100012345678", "1212", "cash"),
  A("121231", "aaib Bank Acc.No. 1100000000000001", "1212", "cash"),
  A("121260", "Visa", "1212", "cash"),
  A("122200", "Trade Receivables (Gross)", "122", "ar"),
  A("123000", "Trading Inventory", "12", "inventory"),
  A("127000", "Witholding Tax", "12", "other_ca"),
  A("211100", "Suppliers", "211", "ap"),
  A("211302", "Tax (VAT) Payable", "211", "tax_liab"),
  A("211304", "Witholding Tax l", "211", "tax_liab"),
  A("211400", "Accrued Expenses", "211", "other_cl"),
  A("211501", "Facilities- aaib", "2115", "std"),
  A("242", "Advance from Customers", "2", "other_cl"),
  A("340000", "Owners Current Account", "3", "other_equity"),
  A("410000", "Revenues", "4", "revenue"),
  A("421000", "Interest Income", "4", "interest_income"),
  A("510000", "Cost of Sales", "51", "cos_variable"),
  A("521100", "Salaries & Allowances", "521", "exp_fixed"),
  A("522006", "Office Rent", "522", "exp_fixed"),
  A("531300", "Tender Book - Sales Epenses", "531", "exp_fixed"),
  A("542000", "Lap Tops Depreciation Exp.", "54", "exp_depreciation"),
  A("5470", "Repair& maintenance EXP", "54", "exp_fixed"),
  A("550000", "Financing Interest", "55", "interest_expenses"),
  A("99999", "Undistributed Profits/Losses", "none", "retained_earnings"),
  A("", "xy opining balance", "none", "other_equity"),
  A("", "z Adjustment", "none", null),
  A("z.33", "Foreign Exchange Gain", "none", "other_income"),
  A("z.39", "Foreign Exchange loss", "none", "other_expenses"),
];
const key = (a: Acct) => a.code || a.name;
const by = (code: string) => ACCOUNTS.find((a) => key(a) === code)!;

/** Opening balances (debit − credit) on 1 January 2026; they net to zero. */
const OPENING: Record<string, number> = {
  "1015019": 15000, "111201": 290000, "111202": -180500.4, "121101": 98000.25, "121102": 4000, "121103": 12500.5,
  "121221": 5200000.8, "121231": 260000.1, "122200": 9100000.35, "123000": 31500000.6, "127000": 1900000.2,
  "211100": -4100000.75, "211302": -24000000.3, "211501": -7500000.45, "242": -26000000.9, "340000": -18000000,
  "99999": -52000000.15, "xy opining balance": -21000000.5, "z Adjustment": 175000.4,
};
OPENING["121260"] = -Object.values(OPENING).reduce((a, b) => a + b, 0); // Visa absorbs the rounding so debits equal credits

export interface Move { date: string; ref: string; lines: [string, number][] }
export const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const r2 = (x: number) => Math.round(x * 100) / 100;
/** US format, as Odoo exports with the English (US) language: month first. Days 1–12 make most dates ambiguous on purpose. */
const us = (p: string, d: number) => `${p.slice(5)}/${String(d).padStart(2, "0")}/${p.slice(0, 4)}`;

/** Balanced journal entries for Jan–Oct 2026 (October only to the 7th) plus one mis-dated accrual on 31 Dec 2026. */
export function moves(): Move[] {
  const out: Move[] = [];
  let n = 0;
  const mv = (date: string, lines: [string, number][]) => out.push({ date, ref: `MISC/2026/${String(++n).padStart(4, "0")}`, lines: lines.map(([c, v]) => [c, r2(v)]) });
  MONTHS.forEach((p, i) => {
    const s = 6_000_000 + i * 410_000 + (i % 3) * 95_000; // sales before VAT
    const k = p === "2026-10" ? 0.3 : 1; // October stops early
    const sales = r2(s * k), vat = r2(sales * 0.14);
    mv(us(p, 3), [["122200", sales + vat], ["410000", -sales], ["211302", -vat]]);
    mv(us(p, 4), [["510000", sales * 0.55], ["123000", -sales * 0.55]]);
    mv(us(p, 5), [["123000", sales * 0.6], ["211100", -sales * 0.6]]);
    mv(us(p, 6), [["121221", (sales + vat) * 0.8], ["121260", (sales + vat) * 0.05], ["127000", sales * 0.01], ["122200", -((sales + vat) * 0.85 + sales * 0.01)]]);
    mv(us(p, 7), [["211100", sales * 0.5], ["211304", -sales * 0.005], ["121221", -sales * 0.495]]);
    if (p === "2026-10") return;
    mv(us(p, 10), [["521100", 1_420_000], ["121101", -1_420_000]]);
    mv(us(p, 11), [["121101", 1_510_000], ["121221", -1_510_000]]);
    mv(us(p, 12), [["121103", 25_000 + i * 1000], ["121104", 8000], ["121101", -(33_000 + i * 1000)]]);
    mv(us(p, 15), [["522006", 150_000], ["121231", -150_000]]);
    mv(us(p, 16), [["531300", 3000 + i * 250], ["121102", -(3000 + i * 250)]]);
    mv(us(p, 20), [["5470", 45_000], ["121231", -45_000]]);
    mv(us(p, 25), [["550000", 340_000], ["211501", -340_000]]);
    mv(us(p, 26), [["121231", 27_000], ["421000", -27_000]]);
    mv(us(p, 27), i % 2 ? [["z.39", 120_000 + i * 1000], ["121231", -(120_000 + i * 1000)]] : [["121231", 40_000 + i * 500], ["z.33", -(40_000 + i * 500)]]);
    mv(us(p, 28), [["121221", 300_000], ["242", -300_000]]);
    mv(`${p.slice(5)}/${p === "2026-02" ? 28 : 30}/2026`, [["542000", 5000], ["111202", -5000]]);
    if (p === "2026-03") mv(us(p, 3), [["111201", 34_000], ["211100", -34_000]]);
    if (p === "2026-05") mv(us(p, 9), [["1015021", 4000], ["121221", -4000]]);
    if (p === "2026-08") mv(us(p, 31 - 20), [["211400", -6000], ["521100", 6000]]);
  });
  // An accrual dated in the future (a typing error for 2025): Odoo's reports to 10 Oct leave it out, and so must the import.
  mv("12/31/2026", [["211400", -6000], ["521100", 6000]]);
  return out;
}

const CUTOFF = "2026-10-10";
const dayOf = (us: string) => `${us.slice(6)}-${us.slice(0, 2)}-${us.slice(3, 5)}`;
const inPeriod = (m: Move) => dayOf(m.date) <= CUTOFF;

/** Expected (debit − credit) movement per account per month, and the opening, for the moves inside the period. */
export function expected() {
  const mov: Record<string, Record<string, number>> = {};
  for (const m of moves().filter(inPeriod)) for (const [c, v] of m.lines) {
    const p = dayOf(m.date).slice(0, 7);
    (mov[c] ??= {})[p] = r2((mov[c][p] ?? 0) + v);
  }
  return { opening: OPENING, mov };
}

const split = (v: number): [Cell, Cell] => (v > 0.0049 ? [r2(v), null] : v < -0.0049 ? [null, r2(-v)] : [null, null]);

/** Odoo General Ledger export (one sheet, plus Odoo's "Filters" sheet). */
export function generalLedger(): Grid[] {
  const all = moves();
  const rows: Cell[][] = [[null, null, "2026"], [], ["Code", "Account Name", "Date", "Communication", "Partner", "Currency", "Debit", "Credit", "Balance"]];
  let gd = 0, gc = 0;
  for (const a of ACCOUNTS) {
    const k = key(a);
    const lines = all.flatMap((m) => m.lines.filter(([c]) => c === k).map(([, v]) => ({ m, v })));
    const open = OPENING[k] ?? 0;
    const close = r2(open + lines.reduce((s, l) => s + l.v, 0));
    if (!lines.length && !open) continue;
    const d = r2(Math.max(open, 0) + lines.filter((l) => l.v > 0).reduce((s, l) => s + l.v, 0));
    const c = r2(Math.max(-open, 0) + lines.filter((l) => l.v < 0).reduce((s, l) => s - l.v, 0));
    gd += d; gc += c;
    rows.push([a.code || null, a.code ? a.name : a.name, null, null, null, null, d || null, c || null, close]);
    // Like Odoo, undistributed profits and code-less accounts show no "Initial Balance" row: their heading still carries the balance.
    if (!lines.length) continue;
    let run = open;
    if (open) rows.push([null, "Initial Balance", null, null, null, null, ...split(open), r2(open)]);
    for (const l of lines) { run = r2(run + l.v); rows.push([null, l.m.ref, l.m.date, `Entry ${l.m.ref}`, "", null, ...split(l.v), run]); }
    rows.push([null, `Total ${k} ${a.name}`, null, null, null, null, d || null, c || null, close]);
  }
  rows.push([null, "Total", null, null, null, null, r2(gd), r2(gc), null]);
  return [{ name: "General Ledger", rows }, { name: "Filters", rows: [["Company", "Example Trading Egypt"]] }];
}

/** Odoo Trial Balance export: Initial Balance / period / End Balance groups, hierarchical group rows, Total row. */
export function trialBalance(): Grid[] {
  const { opening, mov } = expected();
  const per = (k: string) => r2(Object.values(mov[k] ?? {}).reduce((a, b) => a + b, 0));
  const leafRow = (a: Acct): Cell[] => { const k = key(a), o = opening[k] ?? 0, m = per(k); return [a.code || null, a.code ? a.name : a.name, ...split(o), ...split(m), ...split(r2(o + m))]; };
  const rows: Cell[][] = [[null, null, "Initial Balance", null, "From 01/01/2026\nto  10/10/2026", null, "End Balance", null], [], ["Code", "Account Name", "Debit", "Credit", "Debit", "Credit", "Debit", "Credit"]];
  const live = ACCOUNTS.filter((a) => (opening[key(a)] ?? 0) || per(key(a)));
  const groupRow = (label: string, accs: Acct[]): Cell[] => {
    const sum = (f: (k: string) => number) => accs.reduce((s, a) => s + f(key(a)), 0);
    const o = sum((k) => opening[k] ?? 0), m = sum(per);
    return [null, label, ...split(o), ...split(m), ...split(o + m)];
  };
  const emitted = new Set<string>();
  const walk = (prefix: string) => {
    for (const a of live.filter((x) => x.group === prefix)) { rows.push(leafRow(a)); emitted.add(key(a)); }
    for (const [g, label] of GROUPS.filter(([g]) => g.length > prefix.length && g.startsWith(prefix) && !GROUPS.some(([h]) => h.length > prefix.length && h.length < g.length && g.startsWith(h) && h.startsWith(prefix)))) {
      const accs = live.filter((x) => x.group.startsWith(g) && x.group !== "none");
      if (!accs.length) continue;
      rows.push(groupRow(label, accs));
      walk(g);
    }
  };
  for (const [g, label] of GROUPS.filter(([g]) => g.length === 1)) {
    const accs = live.filter((x) => x.group.startsWith(g) && x.group !== "none");
    if (!accs.length) continue;
    rows.push(groupRow(label, accs));
    walk(g);
  }
  const none = live.filter((a) => a.group === "none");
  rows.push(groupRow("(No Group)", none));
  for (const a of none) rows.push(leafRow(a));
  // Odoo's Total row prints both sides of each group; equal by construction.
  const both = (o: number[]) => o.map((v) => r2(v));
  const d = (f: (k: string) => number) => live.reduce((s, a) => s + Math.max(f(key(a)), 0), 0);
  const c = (f: (k: string) => number) => live.reduce((s, a) => s + Math.max(-f(key(a)), 0), 0);
  rows.push([null, "Total", ...both([d((k) => opening[k] ?? 0), c((k) => opening[k] ?? 0), d(per), c(per), d((k) => (opening[k] ?? 0) + per(k)), c((k) => (opening[k] ?? 0) + per(k))])]);
  return [{ name: "Trial Balance", rows }, { name: "Filters", rows: [["Company", "Example Trading Egypt"]] }];
}

/** Odoo Profit and Loss export for 1 Jan – 10 Oct 2026 in one Balance column; exchange gains sit under Revenue, as Odoo prints them. */
export function profitAndLoss(): Grid[] {
  const { mov } = expected();
  const nat = (k: string) => { const v = r2(Object.values(mov[k] ?? {}).reduce((a, b) => a + b, 0)); return by(k).cls && ["revenue", "other_income", "interest_income"].includes(by(k).cls!) ? -v : v; };
  const sec = (title: string, ks: string[]) => [[null, title, r2(ks.reduce((s, k) => s + nat(k), 0))], ...ks.map((k) => [k, by(k).name, nat(k)]), [null, `Total ${title}`, r2(ks.reduce((s, k) => s + nat(k), 0))]] as Cell[][];
  const rev = ["410000", "z.33"], cos = ["510000"], opex = ["521100", "522006", "531300", "5470", "550000", "z.39"], oi = ["421000"], oe = ["542000"];
  const t = (ks: string[]) => ks.reduce((s, k) => s + nat(k), 0);
  const gp = r2(t(rev) - t(cos)), op = r2(gp - t(opex)), np = r2(op + t(oi) - t(oe));
  const rows: Cell[][] = [["From 01/01/2026\nto  10/10/2026"], [], ["Code", "Account Name", "Balance"],
    ...sec("Revenue", rev), ...sec("Less Costs of Revenue", cos), [], [null, "Gross Profit", gp], ...sec("Less Operating Expenses", opex), [],
    [null, "Operating Income (or Loss)", op], ...sec("Plus Other Income", oi), ...sec("Less Other Expenses", oe), [], [null, "Net Profit", np]];
  return [{ name: "Profit and Loss", rows }, { name: "Filters", rows: [["Company", "Example Trading Egypt"]] }];
}

export const PNL_NET_PROFIT = () => { const g = profitAndLoss()[0].rows; return g[g.length - 1][2] as number; };
