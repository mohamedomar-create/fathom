/**
 * A test set of files as Egyptian companies actually send them, all describing one made-up company ("Delta Trading",
 * six months of 2026): Odoo and other systems' exports, Arabic and English, the unified chart with parent rows,
 * merged and two-row headings, CSV in UTF-8 / UTF-16 / Windows-1256, journals, ledgers, YTD, thousands, budgets.
 * Every file is generated from the same books, so each must import to exactly the same figures.
 * Nothing here is real client data (this repository is public).
 */
import * as XLSX from "@e965/xlsx";
import type { ClassKey } from "@/lib/engine";
import { isPL, toNatural } from "@/lib/company/build";

type Cell = string | number | Date | null;
export const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
const EN_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const AR_MON = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو"];

interface Account { key: string; en: string; code: string; ar: string; uni: string; cls: ClassKey }
export const ACCOUNTS: Account[] = [
  { key: "cash", en: "Cash on hand", code: "101001", ar: "النقدية بالخزينة", uni: "1801", cls: "cash" },
  { key: "bank", en: "Bank - CIB", code: "101002", ar: "البنك التجاري الدولي", uni: "1802", cls: "cash" },
  { key: "ar", en: "Customers", code: "121000", ar: "العملاء", uni: "1501", cls: "ar" },
  { key: "inv", en: "Inventory", code: "110000", ar: "مخزون بضاعة بغرض البيع", uni: "1401", cls: "inventory" },
  { key: "fa", en: "Vehicles", code: "151000", ar: "وسائل نقل وانتقال", uni: "1104", cls: "fixed_assets" },
  { key: "accdep", en: "Accumulated depreciation - vehicles", code: "151100", ar: "مجمع إهلاك وسائل النقل", uni: "1109", cls: "fixed_assets" },
  { key: "ap", en: "Suppliers", code: "201000", ar: "الموردين", uni: "2601", cls: "ap" },
  { key: "vat", en: "VAT payable", code: "202000", ar: "مصلحة الضرائب - ضريبة القيمة المضافة", uni: "2701", cls: "tax_liab" },
  { key: "cap", en: "Share capital", code: "301000", ar: "رأس المال المدفوع", uni: "2101", cls: "other_equity" },
  { key: "re", en: "Retained earnings", code: "302000", ar: "أرباح مرحلة", uni: "2203", cls: "retained_earnings" },
  { key: "sales", en: "Sales", code: "400000", ar: "مبيعات", uni: "4101", cls: "revenue" },
  { key: "cogs", en: "Cost of goods sold", code: "500000", ar: "تكلفة البضاعة المباعة", uni: "3401", cls: "cos_variable" },
  { key: "sal", en: "Salaries", code: "600000", ar: "مرتبات وأجور", uni: "3101", cls: "exp_fixed" },
  { key: "rent", en: "Rent", code: "610000", ar: "إيجار", uni: "3301", cls: "exp_fixed" },
  { key: "dep", en: "Depreciation expense", code: "620000", ar: "إهلاكات", uni: "3501", cls: "exp_depreciation" },
  { key: "bankch", en: "Bank charges", code: "630000", ar: "رسوم بنكية", uni: "3302", cls: "exp_variable" },
];
const A = Object.fromEntries(ACCOUNTS.map((a) => [a.key, a])) as Record<string, Account>;
export const PL_ACCOUNTS = ACCOUNTS.filter((a) => isPL(a.cls));
export const BS_ACCOUNTS = ACCOUNTS.filter((a) => !isPL(a.cls));

/** Opening balances on 1 Jan 2026 and each month's movements, debit positive. */
export function books() {
  const opening: Record<string, number> = { cash: 20000, bank: 300000, ar: 150000, inv: 200000, fa: 400000, accdep: -80000, ap: -120000, vat: -30000, cap: -500000, re: -340000 };
  const mov: Record<string, Record<string, number>> = Object.fromEntries(ACCOUNTS.map((a) => [a.key, {}]));
  const post = (p: string, entries: [string, number][]) => {
    const net = entries.reduce((s, [, v]) => s + v, 0);
    if (Math.abs(net) > 1e-6) throw new Error(`unbalanced entry in ${p}`);
    for (const [k, v] of entries) mov[k][p] = Math.round(((mov[k][p] ?? 0) + v) * 100) / 100;
  };
  let vatDue = 30000;
  MONTHS.forEach((p, i) => {
    const sales = 250000 + 30000 * i, purchases = 160000 + 10000 * i, collected = 260000 + 40000 * i, paid = 150000 + 10000 * i;
    const charges = 450 + 70 * i;
    post(p, [["ar", sales * 1.14], ["sales", -sales], ["vat", -sales * 0.14]]);
    post(p, [["cogs", sales * 0.6], ["inv", -sales * 0.6]]);
    post(p, [["inv", purchases], ["ap", -purchases]]);
    post(p, [["bank", collected], ["ar", -collected]]);
    post(p, [["ap", paid], ["bank", -paid]]);
    post(p, [["sal", 60000], ["bank", -60000]]);
    post(p, [["cash", 15000], ["bank", -15000]]);
    post(p, [["rent", 15000], ["cash", -15000]]);
    post(p, [["dep", 5000], ["accdep", -5000]]);
    post(p, [["bankch", charges], ["bank", -charges]]);
    post(p, [["vat", vatDue], ["bank", -vatDue]]);
    vatDue = sales * 0.14;
  });
  return { opening, mov };
}

const B = books();
const r2 = (x: number) => Math.round(x * 100) / 100 || 0;
const movOf = (k: string, p: string) => B.mov[k][p] ?? 0;
const cum = (k: string, upto: string) => (B.opening[k] ?? 0) + MONTHS.filter((p) => p <= upto).reduce((s, p) => s + movOf(k, p), 0);
/** Raw (debit-positive) figure an account shows: P&L movement of the month, balance-sheet closing balance. */
const rawAt = (a: Account, p: string) => (isPL(a.cls) ? movOf(a.key, p) : cum(a.key, p));
/** As printed in a statement: revenue and liabilities positive, costs positive. */
const natAt = (a: Account, p: string) => r2(toNatural(a.cls, rawAt(a, p)));
const profit = (p: string) => PL_ACCOUNTS.reduce((s, a) => s - movOf(a.key, p), 0);
const ytdProfit = (p: string) => MONTHS.filter((q) => q <= p).reduce((s, q) => s + profit(q), 0);

/** What every file must import to: class totals per month (P&L for the month, balance sheet at month end). */
export function expectedTotals() {
  const out: Record<string, Partial<Record<ClassKey, number>>> = {};
  for (const p of MONTHS) {
    const t: Partial<Record<ClassKey, number>> = {};
    for (const a of ACCOUNTS) t[a.cls] = r2((t[a.cls] ?? 0) + natAt(a, p));
    out[p] = t;
  }
  return out;
}
/** For a file holding one range (the six months together): P&L summed, balance sheet at the end. */
export function expectedRange() {
  const t: Partial<Record<ClassKey, number>> = {};
  for (const a of ACCOUNTS) t[a.cls] = r2((t[a.cls] ?? 0) + (isPL(a.cls) ? MONTHS.reduce((s, p) => s + natAt(a, p), 0) : natAt(a, MONTHS[5])));
  return t;
}

// ------------------------------------------------------------------ writers

const xlsx = (sheets: { name: string; rows: Cell[][]; merges?: string[]; origin?: string }[]) => {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([], { cellDates: true });
    XLSX.utils.sheet_add_aoa(ws, s.rows, { origin: s.origin ?? "A1", cellDates: true });
    if (s.merges) ws["!merges"] = s.merges.map((m) => XLSX.utils.decode_range(m));
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
};
const csvText = (rows: Cell[][], sep = ",") => rows.map((r) => r.map((v) => {
  const t = v === null ? "" : String(v);
  return new RegExp(`[${sep}"\\n]`).test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}).join(sep)).join("\r\n");
const utf8 = (s: string) => new TextEncoder().encode(s);
const utf16le = (s: string) => {
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff; out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[2 + i * 2] = c & 255; out[3 + i * 2] = c >> 8; }
  return out;
};
const cp1256 = (() => {
  const dec = new TextDecoder("windows-1256");
  const map = new Map<string, number>();
  for (let b = 0; b < 256; b++) map.set(dec.decode(new Uint8Array([b])), b);
  return (s: string) => Uint8Array.from([...s].map((ch) => { const b = map.get(ch); if (b === undefined) throw new Error(`not in cp1256: ${ch}`); return b; }));
})();
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arDigits = (s: string) => s.replace(/\d/g, (d) => AR_DIGITS[+d]).replace(/\./g, "٫").replace(/,/g, "٬");
const fmt = (x: number, dec = 2) => x.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtEU = (x: number) => fmt(x).replace(/,/g, "#").replace(/\./g, ",").replace(/#/g, ".");
const lastDay = (p: string) => new Date(Date.UTC(+p.slice(0, 4), +p.slice(5), 0)).getUTCDate();
const dmy = (p: string, d = lastDay(p)) => `${String(d).padStart(2, "0")}/${p.slice(5)}/${p.slice(0, 4)}`;
const mdy = (p: string, d = lastDay(p)) => `${p.slice(5)}/${String(d).padStart(2, "0")}/${p.slice(0, 4)}`;
const enMon = (p: string) => `${EN_MON[MONTHS.indexOf(p)]} ${p.slice(0, 4)}`;
const arMon = (p: string) => `${AR_MON[MONTHS.indexOf(p)]} ${p.slice(0, 4)}`;
const dc = (raw: number): [number | null, number | null] => (raw >= 0 ? [r2(raw) || null, null] : [null, r2(-raw)]);

// ------------------------------------------------------------------ building blocks

/** English P&L with month columns, sections, subtotals and a net profit row. */
function enPL(cols: (p: string) => Cell, val: (a: Account, p: string) => Cell = natAt, extra: { title?: Cell[][]; total?: boolean } = {}): Cell[][] {
  const head: Cell[] = ["", ...MONTHS.map(cols), ...(extra.total ? ["Total"] : [])];
  const line = (a: Account) => [`${a.code} ${a.en}`, ...MONTHS.map((p) => val(a, p)), ...(extra.total ? [r2(MONTHS.reduce((s, p) => s + natAt(a, p), 0))] : [])];
  return [
    ...(extra.title ?? [["Delta Trading"], ["Profit and Loss"]]),
    head,
    ["Income"], line(A.sales), ["Total Income", ...MONTHS.map((p) => natAt(A.sales, p))],
    ["Cost of Goods Sold"], line(A.cogs), ["Gross Profit", ...MONTHS.map((p) => r2(natAt(A.sales, p) - natAt(A.cogs, p)))],
    ["Expenses"], line(A.sal), line(A.rent), line(A.dep), line(A.bankch),
    ["Total Expenses", ...MONTHS.map((p) => r2(natAt(A.sal, p) + natAt(A.rent, p) + natAt(A.dep, p) + natAt(A.bankch, p)))],
    ["Net Profit", ...MONTHS.map((p) => r2(profit(p)))],
  ];
}

/** English balance sheet; retained earnings split into brought forward and the year's profit, as most systems print it. */
function enBS(cols: (p: string) => Cell): Cell[][] {
  const line = (a: Account) => [`${a.code} ${a.en}`, ...MONTHS.map((p) => (a.key === "re" ? r2(-B.opening.re) : natAt(a, p)))];
  const assets = BS_ACCOUNTS.filter((a) => ["cash", "ar", "inventory", "fixed_assets"].includes(a.cls));
  const total = (as: Account[]) => MONTHS.map((p) => r2(as.reduce((s, a) => s + natAt(a, p), 0)));
  return [
    ["Delta Trading"], ["Balance Sheet"],
    ["", ...MONTHS.map(cols)],
    ["Assets"], ...assets.map(line), ["Total Assets", ...total(assets)],
    ["Liabilities"], line(A.ap), line(A.vat),
    ["Equity"], line(A.cap), line(A.re), ["Current Year Earnings", ...MONTHS.map((p) => r2(ytdProfit(p)))],
    ["Total Liabilities and Equity", ...total(assets)],
  ];
}

/** Arabic statement with a code column, unified codes, Arabic month names (read by the code/name reader). */
function arStatement(kind: "PL" | "BS", name = (a: Account) => a.ar): Cell[][] {
  const head: Cell[] = ["رقم الحساب", "اسم الحساب", ...MONTHS.map(arMon)];
  const row = (a: Account) => [a.uni, name(a), ...MONTHS.map((p) => (a.key === "re" ? r2(-B.opening.re) : natAt(a, p)))];
  if (kind === "PL") return [["شركة دلتا للتجارة"], ["قائمة الدخل"], head,
    [null, "الإيرادات"], row(A.sales), [null, "إجمالي الإيرادات", ...MONTHS.map((p) => natAt(A.sales, p))],
    [null, "المصروفات"], ...[A.cogs, A.sal, A.rent, A.dep, A.bankch].map(row),
    [null, "صافي الربح", ...MONTHS.map((p) => r2(profit(p)))]];
  return [["شركة دلتا للتجارة"], ["الميزانية"], head,
    [null, "الأصول"], ...BS_ACCOUNTS.filter((a) => ["cash", "ar", "inventory", "fixed_assets"].includes(a.cls)).map(row),
    [null, "الخصوم وحقوق الملكية"], ...[A.ap, A.vat, A.cap, A.re].map(row),
    ["2204", "أرباح العام", ...MONTHS.map((p) => r2(ytdProfit(p)))]];
}

/** Unified-chart groups printed above their accounts, each with its own code and totals (parent rows). */
const PARENTS: { code: string; ar: string; en: string }[] = [
  { code: "1", ar: "الأصول", en: "Assets" }, { code: "11", ar: "الأصول الثابتة", en: "Fixed assets" }, { code: "14", ar: "المخزون", en: "Inventory" },
  { code: "15", ar: "العملاء وأوراق القبض", en: "Receivables" }, { code: "18", ar: "النقدية بالبنوك والصندوق", en: "Cash and banks" },
  { code: "2", ar: "حقوق الملكية والخصوم", en: "Equity and liabilities" }, { code: "21", ar: "رأس المال", en: "Capital" }, { code: "22", ar: "الاحتياطيات والأرباح المرحلة", en: "Reserves" },
  { code: "26", ar: "الموردون", en: "Suppliers" }, { code: "27", ar: "حسابات دائنة", en: "Payables" },
  { code: "3", ar: "المصروفات", en: "Expenses" }, { code: "31", ar: "الأجور", en: "Wages" }, { code: "33", ar: "المستلزمات الخدمية", en: "Services" },
  { code: "34", ar: "مشتريات بغرض البيع", en: "Goods for resale" }, { code: "35", ar: "مصروفات تحويلية", en: "Transfer expenses" },
  { code: "4", ar: "الإيرادات", en: "Revenues" }, { code: "41", ar: "إيرادات النشاط", en: "Operating revenue" },
];

type TBCols = { open: (k: string) => number; move: (k: string) => number; close: (k: string) => number };
const SIX: TBCols = {
  open: (k) => B.opening[k] ?? 0,
  move: (k) => MONTHS.reduce((s, p) => s + movOf(k, p), 0),
  close: (k) => cum(k, MONTHS[5]),
};
/** Trial-balance rows with unified codes and parent rows: [code, name, ...debit/credit pairs]. */
function tbRows(pairs: ((k: string) => number)[], opts: { parents?: boolean; codeOf?: (code: string) => string; en?: boolean; nameFirst?: boolean } = {}): Cell[][] {
  const codeOf = opts.codeOf ?? ((c: string) => c);
  const accounts = [...ACCOUNTS].sort((a, b) => (a.uni < b.uni ? -1 : 1));
  const rows: Cell[][] = [];
  const seen = new Set<string>();
  const sum = (code: string, f: (k: string) => number) => accounts.filter((a) => a.uni.startsWith(code)).reduce((s, a) => s + f(a.key), 0);
  const emit = (code: string, name: string, f: (f0: (k: string) => number) => number) => {
    const cells = pairs.flatMap((pf) => dc(f(pf)));
    const c = codeOf(code);
    rows.push(opts.nameFirst ? [name, c, ...cells] : [c, name, ...cells]);
  };
  for (const a of accounts) {
    if (opts.parents) for (const p of PARENTS) if (a.uni.startsWith(p.code) && !seen.has(p.code)) { seen.add(p.code); emit(p.code, opts.en ? p.en : p.ar, (f) => sum(p.code, f)); }
    emit(a.uni, opts.en ? a.en : a.ar, (f) => f(a.key));
  }
  const tot = pairs.flatMap((pf) => { const d = accounts.reduce((s, a) => s + Math.max(0, pf(a.key)), 0), c = accounts.reduce((s, a) => s + Math.max(0, -pf(a.key)), 0); return [r2(d), r2(c)]; });
  rows.push(opts.nameFirst ? ["الإجمالي", null, ...tot] : [null, opts.en ? "Total" : "الإجمالي", ...tot]);
  return rows;
}

/** Journal lines (one per account and month, dated the month's last day), plus the opening entry on 1 January. */
function journal(date: (p: string, day?: number) => Cell, amount: (x: number) => Cell, label = (a: Account) => `${a.code} ${a.en}`, head: Cell[] = ["Account", "Date", "Debit", "Credit"]): Cell[][] {
  const rows: Cell[][] = [head];
  for (const a of BS_ACCOUNTS) { const v = B.opening[a.key]; if (v) { const [d, c] = dc(v); rows.push([label(a), date(MONTHS[0], 1), d === null ? amount(0) : amount(d), c === null ? amount(0) : amount(c)]); } }
  for (const p of MONTHS) for (const a of ACCOUNTS) { const v = movOf(a.key, p); if (!v) continue; const [d, c] = dc(v); rows.push([label(a), date(p), amount(d ?? 0), amount(c ?? 0)]); }
  return rows;
}

// ------------------------------------------------------------------ the corpus

export interface CorpusFile {
  name: string;
  /** What the file is like, in a few words (shown in the test name). */
  about: string;
  data: Uint8Array;
  /** monthly: every month exact; range: one six-month total ending June. */
  expect: "monthly" | "range";
  statements: ("PL" | "BS")[];
  opts?: { ytd?: "auto" | "yes" | "no" };
  /** Extra facts about how the file was read. */
  check?: { source?: string; dates?: "dmy" | "mdy"; scale?: number; parents?: number; unified?: boolean; skippedBudget?: boolean };
}

const AR_TB_TITLE = ["شركة دلتا للتجارة"], AR_TB_PERIOD = [`ميزان المراجعة عن الفترة من 01/01/2026 إلى ${dmy(MONTHS[5])}`];
const AR_TB_GROUPS: Cell[] = ["رقم الحساب", "اسم الحساب", "رصيد أول المدة", null, "حركة الفترة", null, "رصيد آخر المدة", null];
const AR_TB_DC: Cell[] = [null, null, "مدين", "دائن", "مدين", "دائن", "مدين", "دائن"];
const arTB = (parents = true) => [AR_TB_TITLE, AR_TB_PERIOD, AR_TB_GROUPS, AR_TB_DC, ...tbRows([SIX.open, SIX.move, SIX.close], { parents })];

export function corpus(): CorpusFile[] {
  const files: CorpusFile[] = [];
  const add = (f: CorpusFile) => files.push(f);

  add({ name: "en-pl-bs-monthly.xlsx", about: "English P&L and balance sheet, month columns, subtotals", expect: "monthly", statements: ["PL", "BS"],
    data: xlsx([{ name: "Profit and Loss", rows: enPL(enMon) }, { name: "Balance Sheet", rows: enBS(enMon) }]) });
  add({ name: "ar-pl-bs-monthly.xlsx", about: "Arabic statements, unified codes in their own column, Arabic month names", expect: "monthly", statements: ["PL", "BS"],
    data: xlsx([{ name: "قائمة الدخل", rows: arStatement("PL") }, { name: "الميزانية", rows: arStatement("BS") }]), check: { unified: true } });
  add({ name: "ar-pl-bs-spelling.xlsx", about: "Arabic statements spelled without hamza and with ه for ة", expect: "monthly", statements: ["PL", "BS"],
    data: xlsx([{ name: "قائمة الدخل", rows: arStatement("PL", (a) => a.ar.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه")) }, { name: "الميزانية", rows: arStatement("BS", (a) => a.ar.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه")) }]) });
  add({ name: "ar-tb-merged.xlsx", about: "Arabic trial balance, unified chart with coded parent rows, merged two-row headings", expect: "range", statements: ["PL", "BS"],
    data: xlsx([{ name: "ميزان المراجعة", rows: arTB(), merges: ["A3:A4", "B3:B4", "C3:D3", "E3:F3", "G3:H3"] }]), check: { parents: PARENTS.length, unified: true, source: "Trial balance" } });
  add({ name: "ar-tb-utf8.csv", about: "the same trial balance as UTF-8 CSV, headings on two rows", expect: "range", statements: ["PL", "BS"],
    data: utf8(csvText(arTB())), check: { parents: PARENTS.length } });
  add({ name: "ar-tb-utf16.txt", about: "the same as Excel 'Unicode text' (UTF-16, tab separated)", expect: "range", statements: ["PL", "BS"],
    data: utf16le(csvText(arTB(), "\t")) });
  add({ name: "ar-tb-cp1256.csv", about: "the same saved by an Arabic Windows system (code page 1256)", expect: "range", statements: ["PL", "BS"],
    data: cp1256(csvText(arTB(false))) });
  add({ name: "ar-tb-name-first.xlsx", about: "trial balance with the name column before the code (right-to-left sheet)", expect: "range", statements: ["PL", "BS"],
    data: xlsx([{ name: "TB", rows: [AR_TB_TITLE, AR_TB_PERIOD, ["اسم الحساب", "رقم الحساب", "رصيد أول المدة", null, "الحركة", null, "رصيد آخر المدة", null], [null, null, "مدين", "دائن", "مدين", "دائن", "مدين", "دائن"], ...tbRows([SIX.open, SIX.move, SIX.close], { parents: true, nameFirst: true })] }]) });
  add({ name: "ar-tb-combined-headings.xlsx", about: "trial balance with combined headings (رصيد أول المدة مدين …)", expect: "range", statements: ["PL", "BS"],
    data: xlsx([{ name: "TB", rows: [AR_TB_TITLE, AR_TB_PERIOD, ["رقم الحساب", "اسم الحساب", "رصيد أول المدة مدين", "رصيد أول المدة دائن", "حركة الفترة مدين", "حركة الفترة دائن", "رصيد آخر المدة مدين", "رصيد آخر المدة دائن"], ...tbRows([SIX.open, SIX.move, SIX.close])] }]) });
  add({ name: "ar-tb-balances-only.xlsx", about: "trial balance of closing balances only (رصيد مدين / رصيد دائن)", expect: "range", statements: ["PL", "BS"],
    data: xlsx([{ name: "TB", rows: [AR_TB_TITLE, AR_TB_PERIOD, ["رقم الحساب", "اسم الحساب", "رصيد مدين", "رصيد دائن"], ...tbRows([SIX.close])] }]) });
  add({ name: "en-tb-opening-period-closing.xlsx", about: "English trial balance: Opening/Period/Closing Debit and Credit, dashed codes with parents", expect: "range", statements: ["PL", "BS"],
    data: xlsx([{ name: "Trial Balance", rows: [["Delta Trading"], [`Trial Balance From 01/01/2026 to ${dmy(MONTHS[5])}`], ["Account Code", "Account Name", "Opening Debit", "Opening Credit", "Period Debit", "Period Credit", "Closing Debit", "Closing Credit"],
      ...tbRows([SIX.open, SIX.move, SIX.close], { parents: true, en: true, codeOf: (c) => c.split("").join("-") })] }]), check: { parents: PARENTS.length } });
  add({ name: "en-tb-monthly-dc.xlsx", about: "trial balance with Debit/Credit for every month and an Initial Balance", expect: "monthly", statements: ["PL", "BS"],
    data: xlsx([{ name: "Trial Balance", rows: [["Account", "Initial Balance", null, ...MONTHS.flatMap((p) => [enMon(p), null])], [null, "Debit", "Credit", ...MONTHS.flatMap(() => ["Debit", "Credit"])],
      ...ACCOUNTS.map((a) => [`${a.code} ${a.en}`, ...dc(B.opening[a.key] ?? 0), ...MONTHS.flatMap((p) => dc(movOf(a.key, p)))])] }]) });
  add({ name: "journal-dmy-eu.csv", about: "journal CSV: semicolons, day-first dates, 1.234,56 amounts", expect: "monthly", statements: ["PL", "BS"],
    data: utf8(csvText(journal((p, d) => dmy(p, d), fmtEU), ";")), check: { dates: "dmy" } });
  add({ name: "journal-mdy-us.csv", about: "journal CSV: month-first dates (US), 1,234.56 amounts in quotes", expect: "monthly", statements: ["PL", "BS"],
    data: utf8(csvText(journal((p, d) => mdy(p, d), (x) => fmt(x)))), check: { dates: "mdy" } });
  add({ name: "journal-ar-digits.xlsx", about: "Arabic journal: Arabic headings, Arabic-Indic digits in dates and amounts", expect: "monthly", statements: ["PL", "BS"],
    data: xlsx([{ name: "قيود اليومية", rows: journal((p, d) => arDigits(dmy(p, d)), (x) => arDigits(fmt(x)), (a) => `${a.uni} ${a.ar}`, ["الحساب", "التاريخ", "مدين", "دائن"]) }]) });
  add({ name: "journal-excel-dates.xlsx", about: "journal with real Excel date cells", expect: "monthly", statements: ["PL", "BS"],
    data: xlsx([{ name: "Journal Items", rows: journal((p, d) => new Date(Date.UTC(+p.slice(0, 4), +p.slice(5) - 1, d ?? lastDay(p), 12)), (x) => x) }]) });
  add({ name: "journal-cp1256.csv", about: "Arabic journal saved in code page 1256", expect: "monthly", statements: ["PL", "BS"],
    data: cp1256(csvText(journal((p, d) => dmy(p, d), (x) => fmt(x, 2).replace(/,/g, ""), (a) => `${a.uni} ${a.ar}`, ["الحساب", "التاريخ", "مدين", "دائن"]))) });
  add({ name: "ar-gl-generic.xlsx", about: "Arabic general ledger: account headings, opening balance rows, dated lines", expect: "monthly", statements: ["PL", "BS"],
    data: xlsx([{ name: "دفتر الأستاذ", rows: [["دفتر الأستاذ العام"], ["البيان", "التاريخ", "مدين", "دائن"],
      ...ACCOUNTS.flatMap((a) => [[`${a.uni} ${a.ar}`, null, null, null], ...(B.opening[a.key] ? [["رصيد افتتاحي", null, ...dc(B.opening[a.key])]] : []),
        ...MONTHS.filter((p) => movOf(a.key, p)).map((p) => ["حركة الشهر", dmy(p), ...dc(movOf(a.key, p))])])] }]) });
  add({ name: "en-pl-thousands.xlsx", about: "P&L in thousands", expect: "monthly", statements: ["PL"], check: { scale: 1000 },
    data: xlsx([{ name: "P&L", rows: enPL(enMon, (a, p) => natAt(a, p) / 1000, { title: [["Delta Trading"], ["Profit and Loss (EGP '000)"]] }) }]) });
  add({ name: "en-pl-ytd.xlsx", about: "P&L with year-to-date columns", expect: "monthly", statements: ["PL"],
    data: xlsx([{ name: "P&L", rows: enPL(enMon, (a, p) => r2(MONTHS.filter((q) => q <= p).reduce((s, q) => s + natAt(a, q), 0))).filter((r) => !/^(Total|Gross|Net)/.test(String(r[0]))) }]) });
  add({ name: "en-pl-brackets.xlsx", about: "P&L with costs as bracketed negatives typed as text", expect: "monthly", statements: ["PL"],
    data: xlsx([{ name: "P&L", rows: enPL(enMon, (a, p) => (a.cls === "revenue" ? fmt(natAt(a, p)) : `(${fmt(natAt(a, p))})`)).filter((r) => !/^(Total|Gross|Net)/.test(String(r[0]))) }]) });
  add({ name: "en-pl-budget.xlsx", about: "management P&L with Actual and Budget columns side by side", expect: "monthly", statements: ["PL"], check: { skippedBudget: true },
    data: xlsx([{ name: "P&L", rows: [["Delta Trading"], ["", ...MONTHS.flatMap(() => ["Actual", "Budget"])], ["", ...MONTHS.flatMap((p) => [enMon(p), enMon(p)])],
      ...PL_ACCOUNTS.map((a) => [`${a.code} ${a.en}`, ...MONTHS.flatMap((p) => [natAt(a, p), Math.round(natAt(a, p) * 1.1)])])] }]) });
  add({ name: "quickbooks-pl.xlsx", about: "QuickBooks-style P&L with a Total column", expect: "monthly", statements: ["PL"],
    data: xlsx([{ name: "Profit and Loss", rows: enPL(enMon, natAt, { title: [["Delta Trading"], ["Profit and Loss"], ["January - June 2026"]], total: true }) }]) });
  add({ name: "en-pl-offset.xlsx", about: "P&L placed from cell C4 under a merged title", expect: "monthly", statements: ["PL"],
    data: xlsx([{ name: "P&L", origin: "C2", rows: [["Delta Trading — Profit and Loss", null, null, null, null, null, null], [], ...enPL(enMon).slice(2)], merges: ["C2:I2"] }]) });
  add({ name: "csv-title-currency.csv", about: "CSV with title lines and amounts written with EGP", expect: "monthly", statements: ["PL", "BS"],
    data: utf8(csvText([["Delta Trading"], ["Journal export"], ...journal((p, d) => dmy(p, d), (x) => `EGP ${fmt(x)}`)])) });
  return files;
}
