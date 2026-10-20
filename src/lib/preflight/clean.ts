// Builds the cleaned copy of an upload from the preflight report and the person's decisions. The original grids are
// never changed: every row is copied. Only safe fixes are made on their own (blank rows, title rows, total rows that
// equal the rows above, numbers stored as text, dates written one way); everything else follows a decision. Every row
// left out is listed with its reason.
import type { Grid } from "@/lib/ingest/extract";
import { cleanNum, normAr, type Cell } from "@/lib/ingest/parse";
import { blankRow, CURRENCY_HEAD, dayOf, empty, ERROR_TEXT, numberForm, planColumns, planRows, rowKey, rowNo, rulesFor, text, isoDay } from "./inspect";
import type { Decisions, PreflightReport } from "./types";

export interface CleanChange { sheet: string; kind: string; count: number; detail: string }
export interface Rejected { sheet: string; row: number; reason: string }
export interface Cleaned { grids: Grid[]; changes: CleanChange[]; rejected: Rejected[] }

const copyRow = (r: Cell[] | undefined): Cell[] => (r ?? []).map((c) => (c instanceof Date ? new Date(c.getTime()) : c));

export function cleanWorkbook(grids: Grid[], report: PreflightReport, decisions: Decisions = {}): Cleaned {
  const out: Cleaned = { grids: [], changes: [], rejected: [] };
  for (const s of report.sheets) {
    const g = grids.find((x) => x.name === s.sheet);
    const d = decisions[s.sheet] ?? {};
    if (!g || !(d.include ?? s.include) || s.status === "cannot_import") continue;
    const rules = rulesFor(report.module, s);
    if (!rules || s.headerRow < 0) {
      // Accounts, ageing and payments sheets: their readers handle the layout; the copy is the sheet as uploaded.
      out.grids.push({ ...g, rows: g.rows.map(copyRow), ...(g.formulas ? { formulas: { ...g.formulas } } : {}) });
      continue;
    }
    const change = (kind: string, count: number, detail: string) => { if (count) out.changes.push({ sheet: s.sheet, kind, count, detail }); };
    const reject = (i: number, reason: string) => out.rejected.push({ sheet: s.sheet, row: rowNo(g, i), reason });
    const h = s.headerRow;
    const plan = planColumns(g, h, rules, d);
    const amountCol = rules.amount.map((k) => plan.byField.get(k)).find((c) => c !== undefined);
    const keyCols = ["date", "doc", "ref", "id"].map((k) => plan.byField.get(k)).filter((c): c is number => c !== undefined);
    const rows = planRows(g, h, amountCol, keyCols, { lineCol: rules.lineIf ? plan.byField.get(rules.lineIf) : undefined, totalRx: rules.totalRx });
    const spec = (j: number) => rules.fields.find((f) => f.key === [...plan.byField].find(([, c]) => c === j)?.[0]);

    // The heading row: a column the person chose takes the heading the import reads; one that lost its field says so.
    const head = copyRow(g.rows[h]).map((c, j) => {
      const field = [...plan.byField].find(([, col]) => col === j)?.[0];
      const col = s.columns.find((x) => x.index === j);
      if (field && d.map && field in d.map) return rules.fields.find((f) => f.key === field)!.heading;
      if (!field && typeof c === "string" && rules.fieldOf(c)) return `${text(c)} (not used)`;
      return col?.heading ?? c;
    });
    const titleRows = g.rows.slice(0, h).filter((r) => !blankRow(r)).length;
    change("title_rows", titleRows, `${titleRows} title row(s) above the headings left out`);
    change("blank_rows", rows.blank.length, `${rows.blank.length} blank row(s) left out`);

    const excluded = new Set(d.exclude ?? []);
    const dropTotals = d.dropOddTotals ? rows.oddTotals : [];
    change("total_rows", rows.totals.length + dropTotals.length, `${rows.totals.length + dropTotals.length} total row(s) left out`);
    // Rows that are not lines (an agency statement's collections) stay in the copy as they were: the import skips them.
    const keep = [...rows.data, ...rows.notLines, ...(d.dropOddTotals === false ? rows.oddTotals : [])].sort((a, b) => a - b);
    const notLine = new Set(rows.notLines);
    const required = rules.required.map((grp) => grp.map((k) => plan.byField.get(k)).filter((c): c is number => c !== undefined)).filter((cols) => cols.length);
    const usedCols = [...plan.byField.values()];
    const curCol = s.columns.find((c) => CURRENCY_HEAD.test(normAr(c.heading)))?.index;
    const first = new Map<string, number>();
    let dups = 0, missing = 0, invalid = 0, wrongCur = 0, manual = 0, nums = 0, dates = 0, trimmed = 0;
    const body: Cell[][] = [];
    for (const i of keep) {
      const r = g.rows[i];
      if (excluded.has(i)) { manual++; reject(i, "left out by you"); continue; }
      if (notLine.has(i)) { body.push(copyRow(r)); continue; }
      const k = rowKey(r);
      if (d.duplicates === "keep_first" && first.has(k)) { dups++; reject(i, `duplicate of row ${rowNo(g, first.get(k)!)}`); continue; }
      if (!first.has(k)) first.set(k, i);
      const gap = required.find((cols) => cols.every((c) => empty(r?.[c])));
      if (d.dropMissing && gap) { missing++; reject(i, `no ${gap.map((c) => text(g.rows[h]?.[c])).join(" or ")}`); continue; }
      if (d.dropInvalid) {
        const badCol = usedCols.find((c) => {
          const v = r?.[c];
          if (typeof v === "string" && ERROR_TEXT.test(v.trim())) return true;
          const t = spec(c)?.type;
          return (t === "number" && numberForm(v) === "invalid") || (t === "date" && !empty(v) && dayOf(v, d.dateOrder ?? s.dateOrder) === null && typeof v !== "number");
        });
        if (badCol !== undefined) { invalid++; reject(i, `unreadable ${text(g.rows[h]?.[badCol])} ("${text(r?.[badCol])}")`); continue; }
      }
      if (d.currency && curCol !== undefined && text(r?.[curCol]).toUpperCase() !== d.currency.toUpperCase()) { wrongCur++; reject(i, `in ${text(r?.[curCol]) || "no currency"}, not ${d.currency}`); continue; }
      body.push(copyRow(r).map((v, j) => {
        const t = spec(j)?.type;
        if (t === "number" && numberForm(v) === "text") { nums++; return cleanNum(v); }
        if (t === "date" && !empty(v)) {
          const day = v instanceof Date ? isoDay(v) : dayOf(v, d.dateOrder ?? s.dateOrder);
          if (day && day !== v) { dates++; return day; }
        }
        if (typeof v === "string" && v !== v.replace(/\s+/g, " ").trim() && v.trim()) { trimmed++; return v.replace(/\s+/g, " ").trim(); }
        return v;
      }));
    }
    change("excluded", manual, `${manual} row(s) left out by you`);
    change("duplicates", dups, `${dups} repeated row(s) left out`);
    change("missing_values", missing, `${missing} row(s) missing a required value left out`);
    change("invalid", invalid, `${invalid} row(s) with unreadable values left out`);
    change("currencies", wrongCur, `${wrongCur} row(s) in another currency left out`);
    change("numbers", nums, `${nums} number(s) stored as text read as numbers`);
    change("dates", dates, `${dates} date(s) written as YYYY-MM-DD`);
    change("trimmed", trimmed, `${trimmed} cell(s) with extra spaces trimmed`);
    out.grids.push({ name: g.name, rows: [head, ...body] });
  }
  return out;
}

/** The first rows of a sheet before and after cleaning, side by side, for the preview. */
export function beforeAfter(original: Grid, cleaned: Grid | undefined, n = 20): { before: Cell[][]; after: Cell[][] } {
  return { before: original.rows.slice(0, n).map(copyRow), after: (cleaned?.rows ?? []).slice(0, n).map(copyRow) };
}
