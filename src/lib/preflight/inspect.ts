// Inspects a workbook for one import before anything is imported: sheets, heading row, layout, values and columns.
// Pure and synchronous (runs in the upload worker for large files, and on the server). Never changes the grids.
import type { Grid } from "@/lib/ingest/extract";
import { arRx, cleanNum, detectDateOrder, normAr, parsePeriod, type Cell, type DateOrder, TOTAL_LABEL } from "@/lib/ingest/parse";
import { guessRole, ROLE_LABEL, type SheetRole } from "@/lib/ingest/roles";
import { readAged } from "@/lib/ingest/aged";
import { paymentsHeadingGap, readPayments } from "@/lib/ingest/payments";
import { AGENCY_RULES, EXPENSE_RULES, groupLabel, SALES_RULES, STOCK_KEYS, stockRules, type ListRules } from "./rules";
import type { Decisions, PreflightColumn, PreflightIssue, PreflightModule, PreflightReport, SheetDecision, SheetReport, SheetStatus } from "./types";

const MODULE_LABEL: Record<PreflightModule, string> = {
  accounts: "Accounts", opening: "Opening balances", sales: "Sales", expenses: "Expenses", stock: "Stock", payments: "Receivables, payables & payments", agency: "Agency statement",
};
/** Sheets the upload wizard reads (it routes each to its own kind). */
const WIZARD_ROLES = new Set<SheetRole>(["statement", "sales", "bills", "cashbook", "bank"]);
const STOCK_ROLES = new Set<SheetRole>(["stock_valuation", "stock_moves", "stock_onhand", "products"]);
const STOCK_KEY_OF: Partial<Record<SheetRole, (typeof STOCK_KEYS)[number]>> = { stock_valuation: "stock.valuation.layer", stock_moves: "stock.move.line", stock_onhand: "product.product", products: "product.template" };

export const TOTAL_ROW = TOTAL_LABEL;
export const ERROR_TEXT = /^#(REF!|DIV\/0!|VALUE!|N\/A|NAME\?|NUM!|NULL!|ERROR!|SPILL!|CALC!)/i;
export const CURRENCY_HEAD = arRx(/^(currency|curr\.?|العمله|عمله)$/i);
const COPY_NAME = /copy|نسخه|نسخة|\(\d+\)\s*$/i;
const MAX_ROWS_LISTED = 200;

export const empty = (v: Cell) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
export const text = (v: Cell) => (v === null || v === undefined ? "" : v instanceof Date ? isoDay(v) : String(v).replace(/\s+/g, " ").trim());
const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function colLetter(c: number): string { let s = ""; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }
export const rowNo = (g: Grid, i: number) => (g.origin?.r ?? 0) + i + 1;
export const colOf = (g: Grid, j: number) => colLetter((g.origin?.c ?? 0) + j);
export const blankRow = (r: Cell[] | undefined) => !r || r.every(empty);
const listed = (xs: number[]) => xs.slice(0, MAX_ROWS_LISTED);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
/** "row 8", "rows 5, 7", "rows 1, 2 … and 40 more". */
const rowsText = (rows: number[]) => `${rows.length === 1 ? "row" : "rows"} ${rows.length <= 8 ? rows.join(", ") : `${rows.slice(0, 8).join(", ")} and ${rows.length - 8} more`}`;

/** How a date cell is written: the import reads all of these, once a numeric date's day/month order is known. */
export type DateForm = "excel" | "iso" | "numeric" | "text" | "invalid";
const TEXT_DATE = /^\d{1,2}[\s\-/.]+[A-Za-z]{3,9}[\s\-/.,]+\d{2,4}$|^[A-Za-z]{3,9}[\s\-/.]+\d{1,2},?[\s\-/.]+\d{2,4}$/;
export function dateForm(v: Cell): DateForm {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "invalid" : "excel";
  if (typeof v === "number") return "invalid";
  const s = text(v);
  if (/^\d{4}-\d{1,2}-\d{1,2}([ T][\d:.]+Z?)?$/.test(s)) return "iso";
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(s)) return "numeric";
  if (TEXT_DATE.test(s) && !Number.isNaN(Date.parse(s.replace(/[-/.]/g, " ")))) return "text";
  return "invalid";
}

/** The day a date cell stands for, or null (never guessed: a numeric date needs its column's order). */
export function dayOf(v: Cell, order: DateOrder | null): string | null {
  const f = dateForm(v);
  if (f === "excel") return isoDay(v as Date);
  const s = text(v);
  if (f === "iso") { const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)!; return valid(+m[1], +m[2], +m[3]); }
  if (f === "numeric") {
    if (!order) return null;
    const m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)!;
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return order === "dmy" ? valid(y, +m[2], +m[1]) : valid(y, +m[1], +m[2]);
  }
  if (f === "text") { const t = new Date(s.replace(/[-/.]/g, " ")); return Number.isNaN(t.getTime()) ? null : isoDay(t); }
  return null;
}
function valid(y: number, m: number, d: number): string | null {
  const t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d && y >= 1900 && y <= 2100 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** A number cell: a number, text that reads as one ("1,250.50", "(300)"), empty, a spreadsheet error, or not a number. */
export function numberForm(v: Cell): "number" | "text" | "empty" | "error" | "invalid" {
  if (empty(v)) return "empty";
  if (typeof v === "number") return Number.isFinite(v) ? "number" : "invalid";
  if (typeof v === "string" && ERROR_TEXT.test(v.trim())) return "error";
  if (v instanceof Date || typeof v === "boolean") return "invalid";
  return cleanNum(v) === null ? "invalid" : "text";
}

interface Ctx { g: Grid; d: SheetDecision; issues: PreflightIssue[] }
const add = (ctx: Ctx, i: Omit<PreflightIssue, "sheet">) => ctx.issues.push({ sheet: ctx.g.name, ...i });

/** A decision issue the person has answered is said as done, never left open. */
const decided = (level: PreflightIssue["level"], answered: boolean): PreflightIssue["level"] => (answered ? "info" : level);

// ---------------------------------------------------------------- heading row and columns

function findHeaderRow(g: Grid, rules: ListRules): number {
  let best = -1, score = 0;
  for (let i = 0; i < Math.min(g.rows.length, 30); i++) {
    const r = g.rows[i] ?? [];
    const fields = new Set(r.map((c) => (typeof c === "string" ? rules.fieldOf(c) : null)).filter(Boolean));
    const req = rules.required.filter((grp) => grp.some((k) => fields.has(k))).length;
    const s = fields.size + req * 2;
    if (s > score) { score = s; best = i; }
  }
  if (best >= 0) return best;
  // No heading the import knows: the first row of two or more text cells with rows below it.
  for (let i = 0; i < Math.min(g.rows.length - 1, 30); i++) if ((g.rows[i] ?? []).filter((c) => typeof c === "string" && c.trim()).length >= 2) return -2 - i;
  return -1;
}

interface ColumnPlan { columns: PreflightColumn[]; byField: Map<string, number>; ambiguous: Map<string, number[]> }
export function planColumns(g: Grid, h: number, rules: ListRules, d: SheetDecision): ColumnPlan {
  const head = g.rows[h] ?? [];
  const width = Math.max(head.length, ...g.rows.slice(h + 1, h + 200).map((r) => r?.length ?? 0));
  const auto = new Map<string, number[]>();
  for (let j = 0; j < width; j++) { const f = rules.fieldOf(head[j]); if (f && rules.fields.some((x) => x.key === f)) auto.set(f, [...(auto.get(f) ?? []), j]); }
  const byField = new Map<string, number>();
  const by = new Map<number, PreflightColumn["by"]>();
  const ambiguous = new Map<string, number[]>();
  const chosen = d.map ?? {};
  for (const [f, cols] of auto) {
    if (f in chosen) continue;
    if (cols.length > 1) { ambiguous.set(f, cols); continue; }
    byField.set(f, cols[0]); by.set(cols[0], "heading");
  }
  for (const [f, c] of Object.entries(chosen)) {
    if (c === null || c === undefined || c < 0 || c >= width) continue;
    for (const [k, v] of byField) if (v === c) byField.delete(k);
    byField.set(f, c); by.set(c, "person");
  }
  const fieldAt = new Map([...byField].map(([f, c]) => [c, f]));
  const columns: PreflightColumn[] = [];
  for (let j = 0; j < width; j++) {
    const vals = g.rows.slice(h + 1).map((r) => r?.[j]).filter((v) => !empty(v));
    if (!vals.length && empty(head[j])) continue;
    const kinds = new Set(vals.map((v) => (v instanceof Date || dateForm(v) !== "invalid" ? "date" : numberForm(v) === "number" || numberForm(v) === "text" ? "number" : "text")));
    const kind: PreflightColumn["kind"] = !vals.length ? "empty" : kinds.size > 1 ? "mixed" : ([...kinds][0] as PreflightColumn["kind"]);
    columns.push({ index: j, letter: colOf(g, j), heading: text(head[j]), field: fieldAt.get(j) ?? null, by: fieldAt.has(j) ? by.get(j) ?? "heading" : null, kind });
  }
  return { columns, byField, ambiguous };
}

// ---------------------------------------------------------------- rows

interface RowPlan { data: number[]; blank: number[]; totals: number[]; oddTotals: number[]; notLines: number[] }
export function planRows(g: Grid, h: number, amountCol: number | undefined, keyCols: number[], opts: { lineCol?: number; totalRx?: RegExp } = {}): RowPlan {
  let last = g.rows.length - 1;
  while (last > h && blankRow(g.rows[last])) last--;
  const out: RowPlan = { data: [], blank: [], totals: [], oddTotals: [], notLines: [] };
  let run = 0;
  for (let i = h + 1; i <= last; i++) {
    const r = g.rows[i];
    if (blankRow(r)) { out.blank.push(i); continue; }
    const label = (r ?? []).slice(0, 4).find((c) => typeof c === "string" && c.trim());
    const isTotal = typeof label === "string" && (TOTAL_ROW.test(normAr(label.trim())) || Boolean(opts.totalRx?.test(label.trim()))) && keyCols.every((c) => empty(r?.[c]) || r?.[c] === label);
    if (isTotal) {
      const v = amountCol === undefined ? null : cleanNum(r?.[amountCol] ?? null);
      (v !== null && Math.abs(v - run) <= 0.01 ? out.totals : out.oddTotals).push(i);
      run = 0;
      continue;
    }
    if (opts.lineCol !== undefined && empty(r?.[opts.lineCol])) { out.notLines.push(i); continue; }
    out.data.push(i);
    if (amountCol !== undefined) run += cleanNum(r?.[amountCol] ?? null) ?? 0;
  }
  return out;
}

export const rowKey = (r: Cell[] | undefined) => JSON.stringify((r ?? []).map((c) => (c instanceof Date ? isoDay(c) : typeof c === "string" ? c.trim() : c ?? null)).reduceRight<unknown[]>((acc, c) => (acc.length || c !== null ? [c, ...acc] : acc), []));

// ---------------------------------------------------------------- one sheet

function sheetLevel(ctx: Ctx, opts: { hidden: boolean; copyOf: string | null }) {
  const { g, d } = ctx;
  if (opts.hidden) add(ctx, { code: "hidden_sheet", level: decided("fix", d.include !== undefined), fix: "decision", message: "This sheet is hidden in the workbook.", action: d.include === undefined ? "Hidden sheets are often working or helper sheets, so it is left out. Include it only if it holds data for this import." : d.include ? "Included, as you chose." : "Left out, as you chose." });
  if (opts.copyOf) add(ctx, { code: "duplicate_sheet", level: decided("fix", d.include !== undefined), fix: "decision", message: `This sheet holds the same rows as "${opts.copyOf}".`, action: d.include === undefined ? `It is left out so nothing is counted twice. Include it only if "${opts.copyOf}" should be left out instead.` : d.include ? "Included, as you chose." : "Left out, as you chose." });
  if (g.merges) add(ctx, { code: "merged_cells", level: "info", fix: "auto", message: `${plural(g.merges, "merged area")} in this sheet.`, action: "Merged headings are copied into every cell they cover, so each column keeps its heading. Merged cells in data rows read as one value." });
  if (g.cut?.length) add(ctx, { code: "cut_cells", level: "info", fix: "auto", message: `${plural(g.cut.reduce((s, c) => s + c.cells, 0), "cell")} sit far away from the table.`, action: "They are left out, as if pasted across the sheet. If they hold data, move them next to the table." });
  const nf = Object.keys(g.formulas ?? {}).length;
  if (nf) add(ctx, { code: "formulas", level: "info", fix: "source", message: `${plural(nf, "cell")} hold formulas.`, action: "Each formula's last calculated value is used. If the file was edited and not recalculated, open it in Excel, let it recalculate, then save and upload again." });
}

function layoutOnly(ctx: Ctx, opts: { blankLevel: "info" }) {
  const { g } = ctx;
  let last = g.rows.length - 1;
  while (last > 0 && blankRow(g.rows[last])) last--;
  const first = g.rows.findIndex((r) => !blankRow(r));
  const blanks: number[] = [], errs: number[] = [];
  const errCols = new Set<string>();
  for (let i = first + 1; i < last; i++) if (blankRow(g.rows[i])) blanks.push(rowNo(g, i));
  g.rows.forEach((r, i) => (r ?? []).forEach((c, j) => { if (typeof c === "string" && ERROR_TEXT.test(c.trim())) { errs.push(rowNo(g, i)); errCols.add(colOf(g, j)); } }));
  if (blanks.length) add(ctx, { code: "blank_rows", level: opts.blankLevel, fix: "auto", rows: listed(blanks), message: `${plural(blanks.length, "blank row")} inside the table (${rowsText(blanks)}).`, action: "Blank rows are skipped; nothing to do." });
  if (errs.length) add(ctx, { code: "error_cells", level: "info", fix: "source", rows: listed([...new Set(errs)]), cols: [...errCols], message: `${plural(errs.length, "cell")} show a spreadsheet error (#REF!, #DIV/0!…) in ${rowsText([...new Set(errs)])}.`, action: "The import reports any figure it needs from these cells. Fix the formulas in the file and upload it again." });
}

function listChecks(ctx: Ctx, rules: ListRules, opts: { module: PreflightModule }): { header: number; columns: PreflightColumn[]; dataRows: number; dateOrder: DateOrder | null } {
  const { g, d } = ctx;
  let h = d.headerRow ?? findHeaderRow(g, rules);
  if (h < -1) {
    const guess = -h - 2;
    add(ctx, { code: "no_header", level: d.headerRow === undefined ? "block" : "info", fix: "decision", rows: [rowNo(g, guess)], message: `No heading the ${rules.name} import knows was found.`, needs: `Headings such as ${rules.required.map((grp) => groupLabel(rules, grp)).join(", ")}.`, action: "Choose the row that holds the headings, then say what each needed column is." });
    h = guess;
  } else if (h < 0) {
    add(ctx, { code: "no_header", level: "block", fix: "source", message: "No row of headings was found.", action: "The sheet needs one row of column headings above the data. Add it in the file and upload again." });
    return { header: -1, columns: [], dataRows: 0, dateOrder: null };
  }
  const above = g.rows.slice(0, h).filter((r) => !blankRow(r)).length;
  if (h > 0 && above) add(ctx, { code: "header_below", level: "fix", fix: "auto", rows: [rowNo(g, h)], message: `The headings are on row ${rowNo(g, h)}; ${plural(above, "row")} above ${above === 1 ? "is a title" : "are titles"}.`, action: "The title rows are left out and row " + rowNo(g, h) + " is used as the headings." });

  const plan = planColumns(g, h, rules, d);
  const head = g.rows[h] ?? [];
  const heads = plan.columns.filter((c) => c.heading).map((c) => normAr(c.heading.toLowerCase()));
  const repeated = [...new Set(heads.filter((x, i) => heads.indexOf(x) !== i))];
  if (repeated.length) add(ctx, { code: "repeated_headings", level: "info", fix: "auto", cols: plan.columns.filter((c) => repeated.includes(normAr(c.heading.toLowerCase()))).map((c) => c.letter), message: `Headings used more than once: ${repeated.map((x) => `"${x}"`).join(", ")}.`, action: "Each column is read separately; where two could hold the same field you are asked which one." });

  const pivot = head.filter((c) => typeof c === "string" && parsePeriod(c) !== null).length >= 3;
  if (pivot) add(ctx, { code: "pivot", level: rules.pivotOk ? "info" : "block", fix: rules.pivotOk ? "auto" : "source", message: "The sheet is laid out by month across the columns (a summary, not a list).", action: rules.pivotOk ? "The import reads monthly columns; nothing to do." : `The ${rules.name} import needs one row per line. Export the list from Odoo (list view, not the pivot) and upload it.` });

  for (const [f, cols] of plan.ambiguous) {
    const label = rules.fields.find((x) => x.key === f)?.label ?? f;
    add(ctx, { code: "ambiguous_column", level: "fix", fix: "decision", cols: cols.map((c) => colOf(g, c)), message: `${cols.length} columns could be the ${label}: ${cols.map((c) => `${colOf(g, c)} "${text(head[c])}"`).join(", ")}.`, action: `Choose which column is the ${label}. It is never picked for you, because the wrong one would change the figures.` });
  }
  const missingGroups = pivot && rules.pivotOk ? [] : rules.required.filter((grp) => !grp.some((k) => plan.byField.has(k) || plan.ambiguous.has(k)));
  for (const grp of missingGroups) add(ctx, { code: "missing_column", level: "block", fix: "decision", message: `No column for the ${groupLabel(rules, grp)}.`, needs: `The ${rules.name} import needs a column for the ${groupLabel(rules, grp)}.`, action: `If a column holds it under another heading, choose it below. Otherwise add the column to the export in Odoo and upload again.` });

  const amountCol = rules.amount.map((k) => plan.byField.get(k)).find((c) => c !== undefined);
  const keyCols = ["date", "doc", "ref", "id"].map((k) => plan.byField.get(k)).filter((c): c is number => c !== undefined);
  const rows = planRows(g, h, amountCol, keyCols, { lineCol: rules.lineIf ? plan.byField.get(rules.lineIf) : undefined, totalRx: rules.totalRx });
  const excluded = new Set(d.exclude ?? []);
  if (rows.notLines.length) add(ctx, { code: "blank_rows", level: "info", fix: "auto", rows: listed(rows.notLines.map((i) => rowNo(g, i))), message: `${plural(rows.notLines.length, "row")} have no ${rules.fields.find((f) => f.key === rules.lineIf)?.label ?? rules.lineIf} (such as collections).`, action: "They are not lines of this import and are skipped by it; nothing to do." });
  const data = rows.data.filter((i) => !excluded.has(i));
  if (rows.blank.length) add(ctx, { code: "blank_rows", level: "fix", fix: "auto", rows: listed(rows.blank.map((i) => rowNo(g, i))), message: `${plural(rows.blank.length, "blank row")} inside the table (${rowsText(rows.blank.map((i) => rowNo(g, i)))}).`, action: "Blank rows are left out." });
  if (rows.totals.length) add(ctx, { code: "total_rows", level: "fix", fix: "auto", rows: listed(rows.totals.map((i) => rowNo(g, i))), message: `${plural(rows.totals.length, "total row")} (${rowsText(rows.totals.map((i) => rowNo(g, i)))}) equal the rows above ${rows.totals.length === 1 ? "it" : "them"}.`, action: "Total rows are left out so nothing is counted twice; each was checked against the rows it adds up." });
  if (rows.oddTotals.length) add(ctx, { code: "total_mismatch", level: decided("fix", d.dropOddTotals !== undefined), fix: "decision", rows: listed(rows.oddTotals.map((i) => rowNo(g, i))), message: `${plural(rows.oddTotals.length, "row")} labelled as a total (${rowsText(rows.oddTotals.map((i) => rowNo(g, i)))}) ${rows.oddTotals.length === 1 ? "does" : "do"} not equal the rows above.`, action: d.dropOddTotals === undefined ? "Leave them out if they are totals (the rows above may be incomplete), or keep them if they are real lines named \"Total…\"." : d.dropOddTotals ? "Left out, as you chose." : "Kept as lines, as you chose." });

  // Duplicates: rows identical in every cell.
  const seen = new Map<string, number[]>();
  for (const i of data) { const k = rowKey(g.rows[i]); seen.set(k, [...(seen.get(k) ?? []), i]); }
  const dupGroups = [...seen.values()].filter((v) => v.length > 1);
  if (dupGroups.length) {
    const all = dupGroups.flat().sort((a, b) => a - b).map((i) => rowNo(g, i));
    add(ctx, { code: "duplicates", level: decided("fix", d.duplicates !== undefined), fix: "decision", rows: listed(all), message: `${plural(dupGroups.reduce((s, x) => s + x.length - 1, 0), "row")} repeat another row exactly (${rowsText(all)}).`, action: d.duplicates === undefined ? "Keep one of each if they were exported twice; keep all if they are real separate lines (the same item sold twice on one day)." : d.duplicates === "keep_first" ? "One of each kept, as you chose." : "All kept, as you chose." });
  }

  // Required values on each row.
  const missRows = new Set<number>(), missCols = new Set<string>();
  for (const grp of rules.required) {
    const cols = grp.map((k) => plan.byField.get(k)).filter((c): c is number => c !== undefined);
    if (!cols.length) continue;
    for (const i of data) if (cols.every((c) => empty(g.rows[i]?.[c]))) { missRows.add(i); cols.forEach((c) => missCols.add(colOf(g, c))); }
  }
  if (missRows.size) {
    const rs = [...missRows].sort((a, b) => a - b).map((i) => rowNo(g, i));
    add(ctx, { code: "missing_values", level: decided("fix", Boolean(d.dropMissing)), fix: "decision", rows: listed(rs), cols: [...missCols], message: `${plural(rs.length, "row")} miss a required value (${rowsText(rs)}).`, needs: `Every line needs: ${rules.required.map((grp) => groupLabel(rules, grp)).join(", ")}.`, action: d.dropMissing ? "These rows are left out and listed as rejected, as you approved." : "Fill them in the file and upload again, or approve importing the other rows only (these are listed as rejected)." });
  }

  // Values in the fields the import reads.
  let dateOrder: DateOrder | null = d.dateOrder ?? null;
  const textNum = new Map<number, number[]>(), badNum = new Map<number, number[]>(), errCell = new Map<number, number[]>();
  for (const c of plan.columns) {
    const spec = rules.fields.find((x) => x.key === c.field);
    for (const i of data) {
      const v = g.rows[i]?.[c.index];
      if (typeof v === "string" && ERROR_TEXT.test(v.trim())) { errCell.set(c.index, [...(errCell.get(c.index) ?? []), i]); continue; }
      if (spec?.type !== "number") continue;
      const f = numberForm(v);
      if (f === "text") textNum.set(c.index, [...(textNum.get(c.index) ?? []), i]);
      else if (f === "invalid") badNum.set(c.index, [...(badNum.get(c.index) ?? []), i]);
    }
    if (spec?.type === "date") {
      const vals = data.map((i) => g.rows[i]?.[c.index]).filter((v) => !empty(v) && !(typeof v === "string" && ERROR_TEXT.test(v.trim())));
      const forms = new Set(vals.map(dateForm));
      const found = detectDateOrder(vals);
      if (!dateOrder) dateOrder = found.order;
      const needsOrder = forms.has("numeric") && !found.order;
      if (needsOrder && !d.dateOrder) add(ctx, { code: "date_order", level: "fix", fix: "decision", cols: [c.letter], message: `Dates in column ${c.letter} such as "${text(vals.find((v) => dateForm(v) === "numeric"))}" could be day/month or month/day: no date in the file settles it.`, action: "Say how the dates are written. It is never guessed, because a wrong guess moves sales between months." });
      const bad = data.filter((i) => { const v = g.rows[i]?.[c.index]; return !empty(v) && !(typeof v === "string" && ERROR_TEXT.test(v.trim())) && dateForm(v) === "invalid"; });
      if (bad.length) add(ctx, { code: "invalid_dates", level: decided("fix", Boolean(d.dropInvalid)), fix: "decision", rows: listed(bad.map((i) => rowNo(g, i))), cols: [c.letter], message: `${plural(bad.length, "cell")} in column ${c.letter} are not dates (${rowsText(bad.map((i) => rowNo(g, i)))}).`, action: d.dropInvalid ? "Those rows are left out and listed as rejected, as you approved." : "Correct them in the file, or approve leaving those rows out." });
      const readable = [...forms].filter((f) => f !== "invalid");
      if (readable.length > 1 && (!needsOrder || d.dateOrder)) add(ctx, { code: "date_formats", level: "fix", fix: "auto", cols: [c.letter], message: `Column ${c.letter} writes dates in ${readable.length} ways (${readable.map((f) => ({ excel: "Excel dates", iso: "2026-09-30", numeric: "30/09/2026", text: "30-Sep-2026", invalid: "" })[f]).join(", ")}).`, action: `All are written as YYYY-MM-DD${dateOrder ? ` (read ${dateOrder === "dmy" ? "day first" : "month first"})` : ""}.` });
    }
  }
  const cellsIssue = (code: "text_numbers" | "invalid_numbers" | "error_cells", m: Map<number, number[]>, msg: (n: number, rs: string) => string, action: string, level: PreflightIssue["level"], fix: PreflightIssue["fix"]) => {
    if (!m.size) return;
    const rs = [...new Set([...m.values()].flat())].sort((a, b) => a - b).map((i) => rowNo(g, i));
    add(ctx, { code, level, fix, rows: listed(rs), cols: [...m.keys()].map((j) => colOf(g, j)), message: msg([...m.values()].reduce((s, x) => s + x.length, 0), rowsText(rs)), action });
  };
  cellsIssue("text_numbers", textNum, (n, rs) => `${plural(n, "number")} are stored as text (${rs}).`, "They are read as numbers (thousand separators, brackets for negatives and currency marks are understood).", "fix", "auto");
  cellsIssue("invalid_numbers", badNum, (n, rs) => `${plural(n, "cell")} in an amount or quantity column are not numbers (${rs}).`, d.dropInvalid ? "Those rows are left out and listed as rejected, as you approved." : "Correct them in the file, or approve leaving those rows out. They are never read as zero.", decided("fix", Boolean(d.dropInvalid)), "decision");
  const errInUsed = [...errCell.keys()].some((j) => plan.columns.find((c) => c.index === j)?.field);
  cellsIssue("error_cells", errCell, (n, rs) => `${plural(n, "cell")} show a spreadsheet error (#REF!, #DIV/0!…) in ${rs}.`, errInUsed ? (d.dropInvalid ? "Those rows are left out and listed as rejected, as you approved." : "Fix the formulas in the file and upload again, or approve leaving those rows out.") : "They are in columns the import does not use.", errInUsed ? decided("fix", Boolean(d.dropInvalid)) : "info", errInUsed ? "decision" : "source");

  // Currencies.
  for (const c of plan.columns.filter((x) => CURRENCY_HEAD.test(normAr(x.heading)))) {
    const vals = [...new Set(data.map((i) => text(g.rows[i]?.[c.index]).toUpperCase()).filter(Boolean))].sort();
    if (vals.length > 1) add(ctx, { code: "currencies", level: decided("fix", Boolean(d.currency)), fix: "decision", cols: [c.letter], message: `Amounts are in ${vals.length} currencies (${vals.join(", ")}).`, action: d.currency ? `Only ${d.currency} rows are kept, as you chose; the others are listed as rejected.` : `Amounts in different currencies cannot be added together. Keep one currency (${vals.join(" or ")}), or export the amounts in the company currency from Odoo.` });
  }

  const inDoubt = new Set([...plan.ambiguous.values()].flat());
  const unusedCols = plan.columns.filter((c) => !c.field && !inDoubt.has(c.index)).filter((c) => c.kind !== "empty" || c.heading);
  if (unusedCols.length && opts.module !== "accounts") add(ctx, { code: "unused_columns", level: "info", fix: "auto", cols: unusedCols.map((c) => c.letter), message: `Columns not used by the ${rules.name} import: ${unusedCols.map((c) => `${c.letter} "${c.heading || "(no heading)"}"${c.kind === "mixed" ? " (mixed numbers and text)" : ""}`).join(", ")}.`, action: "They are kept in the file and ignored. If one holds a needed field, choose it below." });

  return { header: h, columns: plan.columns, dataRows: data.length, dateOrder };
}

function statusOf(issues: PreflightIssue[]): SheetStatus {
  if (issues.some((i) => i.level === "block")) return "cannot_import";
  if (issues.some((i) => i.level === "fix")) return "ready_after_fixes";
  return "ready";
}

/** Sheets holding the same rows as an earlier, visible one: the copy is the hidden one, or the one named like a copy. */
function copies(grids: Grid[]): Map<string, string> {
  const out = new Map<string, string>();
  const byKey = new Map<string, Grid[]>();
  for (const g of grids) {
    const rows = g.rows.filter((r) => !blankRow(r));
    if (rows.length < 2) continue;
    const k = rows.map(rowKey).join("\n");
    byKey.set(k, [...(byKey.get(k) ?? []), g]);
  }
  for (const gs of byKey.values()) {
    if (gs.length < 2) continue;
    const rank = (g: Grid) => (g.hidden ? 2 : 0) + (COPY_NAME.test(g.name) ? 1 : 0);
    const original = [...gs].sort((a, b) => rank(a) - rank(b))[0];
    for (const g of gs) if (g !== original) out.set(g.name, original.name);
  }
  return out;
}

/** Inspect every sheet of an upload for one import. `decisions` are the person's answers so far. */
export function inspectWorkbook(grids: Grid[], module: PreflightModule, opts: { decisions?: Decisions; stockMapping?: Record<string, string>; stockKey?: string } = {}): PreflightReport {
  const cp = copies(grids);
  const sheets = grids.map((g): SheetReport => {
    const d: SheetDecision = { ...(opts.decisions?.[g.name] ?? {}) };
    const ctx: Ctx = { g, d, issues: [] };
    const isEmpty = g.rows.every(blankRow);
    const base = { sheet: g.name, hidden: Boolean(g.hidden), empty: isEmpty, copyOf: cp.get(g.name) ?? null, headerRow: -1, headerRowNo: 0, columns: [] as PreflightColumn[], dataRows: 0, dateOrder: null as DateOrder | null, fields: [] as SheetReport["fields"], figures: 0 };
    if (isEmpty) {
      add(ctx, { code: "empty", level: "block", fix: "source", message: "This sheet is empty.", action: "Nothing to import from it; it is left out." });
      return { ...base, role: "notes", roleLabel: "Empty", status: "cannot_import", include: false, issues: ctx.issues };
    }
    const guess = guessRole(g);
    base.figures = guess.figures;
    let role: string = guess.role;
    let rules: ListRules | null = null;
    let relevant = false;
    let stockKey: string | undefined;
    if (module === "agency") { rules = AGENCY_RULES; relevant = g.rows.slice(0, 30).some((r) => (r ?? []).some((c) => AGENCY_RULES.fieldOf(c))); role = "agency"; }
    else if (module === "stock") {
      // The export the person chose on the sample screen decides; the guess only stands in when there is none.
      const key = (opts.stockKey && STOCK_KEYS.includes(opts.stockKey as (typeof STOCK_KEYS)[number]) ? opts.stockKey as (typeof STOCK_KEYS)[number] : null) ?? STOCK_KEY_OF[guess.role] ?? bestStockKey(g);
      stockKey = key;
      rules = stockRules(key);
      relevant = Boolean(opts.stockKey) || STOCK_ROLES.has(guess.role) || Boolean(key && g.rows.slice(0, 15).some((r) => (r ?? []).filter((c) => stockRules(key).fieldOf(c)).length >= 3));
      role = guess.role;
      if (opts.stockMapping) { const head = findHeaderRow(g, rules); if (head >= 0) { const hr = g.rows[head] ?? []; d.map = { ...Object.fromEntries(Object.entries(opts.stockMapping).map(([f, h]) => [f, hr.findIndex((c) => text(c).toLowerCase() === h.toLowerCase())]).filter(([, i]) => (i as number) >= 0)), ...d.map }; } }
    } else if (module === "payments") {
      relevant = Boolean(readAged(g) || readPayments(g));
      role = relevant ? "payments" : guess.role;
      if (!relevant) {
        const gap = paymentsHeadingGap(g);
        if (gap) { relevant = true; add(ctx, { code: "missing_column", level: "block", fix: "source", message: `This sheet ${gap}.`, needs: "An Aged Receivable or Aged Payable report, or a payments list with Date, Number, Journal, Customer/Vendor and the amount.", action: "Add the missing columns to the export in Odoo (Action → Export), then upload again." }); }
      }
    } else {
      // The step the person chose decides first: a sheet with that import's headings is read by it.
      const own = module === "expenses" ? [EXPENSE_RULES, SALES_RULES] : [SALES_RULES, EXPENSE_RULES];
      const listed = module === "sales" || module === "expenses" ? own.find((r) => headingsMatch(g, r) || (d.map && r === own[0])) : null;
      if (listed) { rules = listed; role = listed === SALES_RULES ? "sales" : "bills"; relevant = true; }
      else if (WIZARD_ROLES.has(guess.role) || (guess.role === "summary" && (module === "accounts" || module === "opening"))) {
        relevant = true;
        if (guess.role === "sales") rules = SALES_RULES;
        if (guess.role === "bills") rules = EXPENSE_RULES;
      }
    }
    const roleLabel = role === "agency" ? "Agency statement" : role === "payments" ? "Ageing or payments" : ROLE_LABEL[role as SheetRole] ?? role;
    if (!relevant) {
      add(ctx, { code: "irrelevant", level: "block", fix: "source", message: `This sheet looks like ${roleLabel.toLowerCase()}, not data for ${MODULE_LABEL[module]}.`, needs: `The ${MODULE_LABEL[module]} import reads ${module === "stock" ? "an Odoo stock export (valuation, moves, on hand or products)" : module === "payments" ? "Aged Receivable / Aged Payable reports and payments lists" : module === "agency" ? "a statement with Date, Name (hospital) and Value columns" : "accounts, sales or bills lists, cash books and bank statements"}.`, action: STOCK_ROLES.has(guess.role) ? "Upload it on the Stock step." : "It is left out. Upload it on the step it belongs to, if any." });
      return { ...base, role, roleLabel, status: "cannot_import", include: false, issues: ctx.issues };
    }
    sheetLevel(ctx, { hidden: base.hidden, copyOf: base.copyOf });
    let out = base;
    if (rules) {
      const r = listChecks(ctx, rules, { module });
      out = { ...base, headerRow: r.header, headerRowNo: r.header >= 0 ? rowNo(g, r.header) : 0, columns: r.columns, dataRows: r.dataRows, dateOrder: r.dateOrder, fields: rules.fields.map((f) => ({ key: f.key, label: f.label, required: rules!.required.some((grp) => grp.includes(f.key)) })) };
    } else {
      layoutOnly(ctx, { blankLevel: "info" });
    }
    const include = d.include ?? !(base.hidden || base.copyOf);
    return { ...out, role, roleLabel, include, status: statusOf(ctx.issues), issues: ctx.issues, ...(stockKey ? { stockKey } : {}) };
  });
  const included = sheets.filter((s) => s.include);
  return { module, sheets, ready: included.length > 0 && included.every((s) => s.status === "ready") };
}

/** A row of headings this import knows: two or more fields, one of them required. */
function headingsMatch(g: Grid, rules: ListRules): boolean {
  return g.rows.slice(0, 30).some((r) => {
    const f = new Set((r ?? []).map((c) => rules.fieldOf(c)).filter((x): x is string => Boolean(x)));
    return f.size >= 2 && rules.required.some((grp) => grp.some((k) => f.has(k)));
  });
}

function bestStockKey(g: Grid): (typeof STOCK_KEYS)[number] {
  let best = STOCK_KEYS[0], score = -1;
  for (const k of STOCK_KEYS) {
    const r = stockRules(k);
    const h = findHeaderRow(g, r);
    if (h < 0) continue;
    const fields = new Set((g.rows[h] ?? []).map((c) => r.fieldOf(c)));
    const s = r.required.filter((grp) => grp.some((f) => fields.has(f))).length / r.required.length;
    if (s > score) { score = s; best = k; }
  }
  return best;
}

/** The rules a sheet was checked with (for cleaning and for the column picker). */
export function rulesFor(module: PreflightModule, report: SheetReport): ListRules | null {
  if (module === "agency") return AGENCY_RULES;
  if (module === "stock") return stockRules((report.stockKey as (typeof STOCK_KEYS)[number] | undefined) ?? STOCK_KEY_OF[report.role as SheetRole] ?? "stock.valuation.layer");
  if (report.role === "sales" && module !== "payments") return SALES_RULES;
  if (report.role === "bills" && module !== "payments") return EXPENSE_RULES;
  return null;
}
