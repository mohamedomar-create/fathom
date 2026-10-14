import { headerPeriod } from "./extract";
import { arToLatin, type Cell } from "./parse";
import type { Grid } from "./extract";
import type { PageRead, PageRow } from "./pdf-schema";

/** One page of an uploaded PDF (or image) after reading: where it came from, what was read, and any problem. */
/** `v` counts fresh readings of the page (not corrections), so the review table can start over when a page is read again. */
export interface PdfPage { file: string; n: number; read: PageRead | null; error?: string; rereads?: number; v?: number }

/** A row of figures that does not add up, or could not be read with certainty. */
export interface PdfFlag { file: string; page: number; row: number; kind: "total" | "balance" | "debit_credit" | "unclear"; text: string }

const KIND_TITLE: Record<PageRead["kind"], string> = { pl: "Profit and Loss", bs: "Balance Sheet", tb: "Trial Balance", gl: "General Ledger", sales: "Sales", other: "Other" };

const DEBIT = /^(.*\b)?(debit|dr)\b|مدين/i;
const CREDIT = /^(.*\b)?(credit|cr)\b|دائن/i;
const YEAR_ENDED = /year ended|years? ending|twelve months|12 months|السنة (المالية )?المنتهية|عن السنة/i;
const PART_ENDED: [RegExp, number][] = [[/nine months|9 months|التسعة أشهر|تسعة أشهر/i, 9], [/six months|6 months|half[- ]year|الستة أشهر|ستة أشهر/i, 6], [/three months|3 months|quarter ended|الثلاثة أشهر|ثلاثة أشهر|الربع/i, 3]];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A column heading the importer can date. Headings it already reads ("Dec 2025", "31/12/2025", "2025") are kept.
 * "31 December 2025" becomes "December 2025"; a P&L column for a year or part year ended on a date becomes the range.
 */
export function columnHeading(text: string, kind: PageRead["kind"], dateText = ""): string {
  const t = arToLatin(text).replace(/\s+/g, " ").trim();
  const span = (s: string) => (YEAR_ENDED.test(s) ? 12 : PART_ENDED.find(([rx]) => rx.test(s))?.[1] ?? 0);
  const months = kind === "pl" ? span(t) || span(dateText) : 0;
  const direct = headerPeriod(t);
  // The end month: as printed, or a month and year inside the text ("31 December 2025", "Year ended 31 ديسمبر 2025").
  const monthYear = [...t.matchAll(/(\p{L}+)\.?,?\s+(\d{4})/gu)].pop();
  const end = direct ?? (monthYear ? headerPeriod(`${monthYear[1]} ${monthYear[2]}`) : null);
  if (!end) return text;
  const [y, m] = end.p.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (months > 1 && end.months === 1) {
    const s = new Date(Date.UTC(y, m - months, 1));
    return `From 01/${pad(s.getUTCMonth() + 1)}/${s.getUTCFullYear()} to ${last}/${pad(m)}/${y}`;
  }
  return direct ? text : `${last}/${pad(m)}/${y}`;
}

const sameTable = (a: PageRead, b: PageRead) =>
  a.kind === b.kind && a.kind !== "other" && a.columns.length === b.columns.length && a.columns.every((c, i) => c.trim().toLowerCase() === b.columns[i].trim().toLowerCase());

/** Pages that continue the same table (same kind and the same columns) are joined, so a statement over three pages is one sheet. */
export function groupPages(pages: PdfPage[]): PdfPage[][] {
  const out: PdfPage[][] = [];
  for (const p of pages) {
    if (!p.read || p.read.kind === "other" || !p.read.rows.length) continue;
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && prev.file === p.file && prev.n === p.n - 1 && sameTable(prev.read!, p.read)) last.push(p);
    else out.push([p]);
  }
  return out;
}

const SCALE_NOTE = { units: "", thousands: "Amounts in thousands", millions: "Amounts in millions" } as const;

/** The pages of one table as a sheet: title lines, then Code · Account · columns, then the rows as printed. */
export function tableGrid(group: PdfPage[]): Grid {
  const first = group[0].read!;
  const rows = group.flatMap((p) => p.read!.rows);
  // A sales page (products or customers by month) is laid out for the sales reader: no account heading, codes kept in the name.
  const sales = first.kind === "sales";
  const hasCode = !sales && rows.some((r) => r.code.trim());
  const heads = first.columns.map((c) => columnHeading(c, first.kind, first.dateText));
  const pagesText = group.length > 1 ? `pages ${group[0].n}–${group[group.length - 1].n}` : `page ${group[0].n}`;
  const g: Cell[][] = [
    [first.title || KIND_TITLE[first.kind]],
    ...(first.company ? [[first.company]] : []),
    ...(first.dateText ? [[first.dateText]] : []),
    ...(SCALE_NOTE[first.scale] ? [[SCALE_NOTE[first.scale]]] : []),
    [],
    [...(hasCode ? ["Code"] : []), sales ? "Product" : "Account", ...heads],
    ...rows.map((r) => [...(hasCode ? [r.code.trim() || null] : []), sales && r.code.trim() ? `[${r.code.trim()}] ${r.label}` : r.label, ...(r.heading ? [] : first.columns.map((_, i) => r.values[i] ?? null))]),
  ];
  const file = group[0].file.replace(/\.[^.]+$/, "");
  return { name: `${file} › ${pagesText} · ${(first.title || KIND_TITLE[first.kind]).slice(0, 60)}`.slice(0, 120), rows: g };
}

/** Every table read from the PDF pages, as sheets for the importer. */
export const pdfGrids = (pages: PdfPage[]): Grid[] => groupPages(pages).map(tableGrid);

const TA = /^(total )?assets$|^(إجمالي|اجمالي|مجموع) (الأصول|الاصول)$/i;
const TLE = /^(total )?(liabilities|equity) ?(\+|and|&) ?(equity|liabilities|shareholders'? equity)$|^(إجمالي|اجمالي|مجموع) (الخصوم|الالتزامات|حقوق الملكية) و ?(حقوق (الملكية|المساهمين)|الخصوم|الالتزامات)$/i;

type At = { file: string; page: number; row: number; r: PageRow };

const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Checks that the figures read from a table add up, as printed totals on financial statements always do:
 * each total equals the rows above it it closes (or the first of them less the rest, as gross profit = revenue − cost of sales),
 * a balance sheet balances, and a trial balance's debits equal its credits. A row that fails is named for a second look.
 */
export function checkTable(group: PdfPage[]): PdfFlag[] {
  const first = group[0].read!;
  const cols = first.columns.length;
  const rows: At[] = group.flatMap((p) => p.read!.rows.map((r, i) => ({ file: p.file, page: p.n, row: i, r })));
  const flags: PdfFlag[] = [];
  const val = (r: PageRow, c: number) => r.values[c] ?? 0;
  for (const x of rows) if (x.r.unclear) flags.push({ file: x.file, page: x.page, row: x.row, kind: "unclear", text: `“${x.r.label}”: a figure could not be read with certainty` });

  // Items still open (not yet closed by a total). A total closes the shortest run of open items it equals.
  const open: { vals: number[] }[] = [];
  for (const x of rows) {
    if (x.r.heading) continue;
    const vals = Array.from({ length: cols }, (_, c) => val(x.r, c));
    if (!x.r.total) { open.push({ vals }); continue; }
    if (!vals.some((v) => v !== 0)) { open.push({ vals }); continue; }
    let k = 0;
    for (let n = 1; n <= open.length && !k; n++) {
      const run = open.slice(open.length - n);
      const tol = Math.max(1, n * 0.5) + 1e-6;
      const sumOk = vals.every((v, c) => Math.abs(run.reduce((a, o) => a + o.vals[c], 0) - v) <= tol);
      const netOk = n > 1 && vals.every((v, c) => Math.abs(run[0].vals[c] - run.slice(1).reduce((a, o) => a + o.vals[c], 0) - v) <= tol);
      if (sumOk || netOk) k = n;
    }
    if (k) { open.splice(open.length - k, k); open.push({ vals }); continue; }
    // The rows a total closes may start on an earlier page or may not all be printed: name it, but do not guess what it closes.
    if (open.length) {
      const near = Array.from({ length: cols }, (_, c) => open.reduce((a, o) => a + o.vals[c], 0));
      const c = vals.findIndex((v, i) => v !== 0 && Math.abs(v - near[i]) > 1);
      flags.push({ file: x.file, page: x.page, row: x.row, kind: "total", text: `“${x.r.label}” ${first.columns[Math.max(0, c)] ? `(${first.columns[Math.max(0, c)]}) ` : ""}reads ${fmt(vals[Math.max(0, c)])}, which is not the sum of the rows above it` });
    }
    open.push({ vals });
  }

  if (first.kind === "bs") {
    const ta = rows.find((x) => TA.test(x.r.label.trim()));
    const tle = rows.find((x) => TLE.test(x.r.label.trim()));
    if (ta && tle) for (let c = 0; c < cols; c++) {
      const a = val(ta.r, c), b = val(tle.r, c);
      if (Math.abs(Math.abs(a) - Math.abs(b)) > 1) flags.push({ file: tle.file, page: tle.page, row: tle.row, kind: "balance", text: `Total assets ${fmt(a)} and total liabilities and equity ${fmt(b)} differ by ${fmt(Math.abs(a) - Math.abs(b))}${first.columns[c] ? ` (${first.columns[c]})` : ""}` });
    }
  }

  if (first.kind === "tb") {
    const dr = first.columns.map((h, i) => (DEBIT.test(h) ? i : -1)).filter((i) => i >= 0);
    const cr = first.columns.map((h, i) => (CREDIT.test(h) && !DEBIT.test(h) ? i : -1)).filter((i) => i >= 0);
    const items = rows.filter((x) => !x.r.total && !x.r.heading);
    for (let j = 0; j < Math.min(dr.length, cr.length); j++) {
      const d = items.reduce((a, x) => a + val(x.r, dr[j]), 0), c = items.reduce((a, x) => a + val(x.r, cr[j]), 0);
      if (Math.abs(d - c) > Math.max(1, items.length * 0.5)) {
        const at = rows.find((x) => x.r.total) ?? rows[rows.length - 1];
        flags.push({ file: at.file, page: at.page, row: at.row, kind: "debit_credit", text: `Debits (${first.columns[dr[j]]}) add up to ${fmt(d)} and credits (${first.columns[cr[j]]}) to ${fmt(c)}: they differ by ${fmt(d - c)}` });
      }
    }
  }
  return flags;
}

/** All checks across the tables read from the PDF pages. */
export const pdfChecks = (pages: PdfPage[]): PdfFlag[] => groupPages(pages).flatMap(checkTable);

/** What to ask the reader to look at again on one page: the rows that did not add up there (unclear rows alone are left to the person). */
export function recheckList(page: PdfPage, flags: PdfFlag[]): string[] {
  return flags.filter((f) => f.file === page.file && f.page === page.n && f.kind !== "unclear").map((f) => f.text);
}
