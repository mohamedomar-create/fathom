import { isPL } from "@/lib/company/build";
import { classFromChoice, FIN_HEAD, MARK, MARK_PREFIX, SALES_COLS, type SheetMark } from "@/lib/templates/spec";
import { cleanNum, parseDay, parsePeriod, type Cell } from "./parse";
import type { Grid, RawLine } from "./extract";

/** A mistake in a filled-in template: where it is and how to fix it. */
export interface TemplateProblem { sheet: string; row: number; col?: string; message: string }

const text = (v: Cell) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v)).trim();
const colName = (i: number) => { let s = "", n = i + 1; while (n) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
const sheetName = (g: Grid) => g.name.split(" › ").pop() ?? g.name;

/** Which iReport template sheet a grid is, from the marker in its first cells. */
export function templateMarkOf(g: Grid): SheetMark | null {
  for (const r of g.rows.slice(0, 3)) for (const v of (r ?? []).slice(0, 3)) {
    const t = text(v);
    if (!t.startsWith(MARK_PREFIX)) continue;
    for (const [k, m] of Object.entries(MARK) as [SheetMark, string][]) if (t === m) return k;
    return null;
  }
  return null;
}
export const isTemplateGrid = (g: Grid) => templateMarkOf(g) !== null;

/** A month heading: "2026-01", a date cell, or "Jan 2026". */
function monthOf(v: Cell): string | null {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}`;
  const t = text(v);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(t)) return t;
  return parsePeriod(t);
}

/**
 * Reads a P&L or balance sheet template exactly: every row with figures must name its account and an iReport class
 * of the right statement, every figure must be a number and every month heading a single month. Rows left empty are skipped.
 */
export function readFinancialTemplate(g: Grid): { lines: RawLine[]; periods: string[]; problems: TemplateProblem[] } {
  const mark = templateMarkOf(g);
  const sheet = sheetName(g);
  const problems: TemplateProblem[] = [];
  const stmt = mark === "pl" ? "PL" : "BS";
  const hi = g.rows.findIndex((r) => text(r?.[0]).toLowerCase() === FIN_HEAD[0].toLowerCase() && text(r?.[2]).toLowerCase() === FIN_HEAD[2].toLowerCase());
  if (hi < 0) return { lines: [], periods: [], problems: [{ sheet, row: 1, message: `The heading row (Code, Account, iReport class, then the months) is missing. Download a fresh template and copy your figures into it.` }] };
  const head = g.rows[hi] ?? [];
  const cols: { i: number; p: string }[] = [];
  const seen = new Map<string, number>();
  for (let i = 3; i < head.length; i++) {
    const h = head[i];
    if (text(h) === "") continue;
    const p = monthOf(h);
    if (!p) { problems.push({ sheet, row: hi + 1, col: colName(i), message: `The heading "${text(h)}" is not a month. Write it as YYYY-MM, for example 2026-01.` }); continue; }
    if (seen.has(p)) { problems.push({ sheet, row: hi + 1, col: colName(i), message: `The month ${p} appears twice (columns ${colName(seen.get(p)!)} and ${colName(i)}). Each month needs its own single column.` }); continue; }
    seen.set(p, i); cols.push({ i, p });
  }
  if (!cols.length) problems.push({ sheet, row: hi + 1, message: "No month columns were found after the iReport class column." });
  const lines: RawLine[] = [];
  for (let r = hi + 1; r < g.rows.length; r++) {
    const row = g.rows[r] ?? [];
    const code = text(row[0]), name = text(row[1]), choice = text(row[2]);
    const values: Record<string, number> = {};
    let bad = false, any = false;
    for (const { i, p } of cols) {
      const v = row[i];
      if (v === null || v === undefined || text(v) === "") continue;
      any = true;
      const n = typeof v === "number" ? v : cleanNum(v);
      if (n === null || !Number.isFinite(n)) { problems.push({ sheet, row: r + 1, col: colName(i), message: `"${text(v)}" is not a number. Enter the amount as a plain number.` }); bad = true; continue; }
      if (n) values[p] = n;
    }
    if (!any) continue; // an unused row (its account name and class may be the template's suggestion)
    if (!name) { problems.push({ sheet, row: r + 1, col: "B", message: "This row has figures but no account name." }); continue; }
    const cls = classFromChoice(choice);
    if (!choice) { problems.push({ sheet, row: r + 1, col: "C", message: `"${name}" has figures but no iReport class. Pick one from the drop-down list.` }); continue; }
    if (!cls) { problems.push({ sheet, row: r + 1, col: "C", message: `"${choice}" is not an iReport class. Pick one from the drop-down list (the Classes sheet lists them).` }); continue; }
    if ((stmt === "PL") !== isPL(cls)) { problems.push({ sheet, row: r + 1, col: "C", message: `"${choice}" is a ${isPL(cls) ? "P&L" : "balance sheet"} class but this is the ${stmt === "PL" ? "P&L" : "balance sheet"} sheet. Move the row to the right sheet or change its class.` }); continue; }
    if (bad) continue;
    lines.push({ key: `${g.name}#${r + 1}`, sheet: g.name, row: r + 1, label: code ? `${code} ${name}` : name, code, name, section: "", stmt, kind: "natural", values, opening: 0, forcedCls: cls, template: true });
  }
  return { lines, periods: cols.map((c) => c.p), problems };
}

/** Checks a filled-in sales template row by row; the sales reader then reads it. */
export function checkSalesTemplate(g: Grid): TemplateProblem[] {
  const sheet = sheetName(g);
  const problems: TemplateProblem[] = [];
  const hi = g.rows.findIndex((r) => text(r?.[0]).replace(/\s*\*$/, "").toLowerCase() === SALES_COLS[0].head.toLowerCase());
  if (hi < 0) return [{ sheet, row: 1, message: "The heading row (Invoice date, Invoice number, Customer, …) is missing. Download a fresh template and copy your lines into it." }];
  let rows = 0;
  for (let r = hi + 1; r < g.rows.length; r++) {
    const row = g.rows[r] ?? [];
    if (!SALES_COLS.some((_, i) => text(row[i]) !== "")) continue;
    rows++;
    SALES_COLS.forEach((c, i) => {
      const v = row[i], t = text(v);
      if (!t) { if (c.required) problems.push({ sheet, row: r + 1, col: colName(i), message: `${c.head} is required.` }); return; }
      if (c.key === "date" && !(v instanceof Date) && !(typeof v === "number" && v > 20000 && v < 80000) && !parseDay(t, "dmy")) problems.push({ sheet, row: r + 1, col: colName(i), message: `"${t}" is not a date. Use a date cell or write it day first, e.g. 15/01/2026.` });
      if ((c.key === "qty" || c.key === "amount" || c.key === "cost") && (typeof v === "number" ? false : cleanNum(v) === null)) problems.push({ sheet, row: r + 1, col: colName(i), message: `"${t}" is not a number.` });
    });
    if (problems.length > 200) break;
  }
  if (!rows) problems.push({ sheet, row: hi + 2, message: "The sheet has no sales lines yet." });
  return problems;
}

/** Every problem in the iReport templates among these sheets (other files are not checked here). */
export function templateProblems(grids: Grid[]): TemplateProblem[] {
  return grids.flatMap((g) => {
    const m = templateMarkOf(g);
    if (m === "pl" || m === "bs") return readFinancialTemplate(g).problems;
    if (m === "sales") return checkSalesTemplate(g);
    return [];
  });
}

/** The problems as one message, the first ones listed. */
export function problemText(ps: TemplateProblem[], max = 12): string {
  const list = ps.slice(0, max).map((p) => `• ${p.sheet}, row ${p.row}${p.col ? `, column ${p.col}` : ""}: ${p.message}`).join("\n");
  return `The template has ${ps.length} problem${ps.length === 1 ? "" : "s"} to fix before it can be imported:\n${list}${ps.length > max ? `\n…and ${ps.length - max} more.` : ""}`;
}

