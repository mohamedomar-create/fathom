import ExcelJS from "exceljs";
import { PL_KEYS, type ClassKey } from "@/lib/engine";
import type { BudgetLine, BudgetProduct } from "@/lib/engine/budget";
import type { Grid } from "@/lib/ingest/extract";
import { cleanNum } from "@/lib/ingest/parse";
import { MARK_PREFIX } from "@/lib/templates/spec";

/** The budget template: one sheet by account × month, one sheet of products (units, price, unit cost per month). */
export const BUDGET_MARK = { lines: `${MARK_PREFIX} · Budget by account · v1`, products: `${MARK_PREFIX} · Budget products · v1` };
const PL = new Set<string>(PL_KEYS);
const PROD_HEAD = ["Product", "Category", "Month", "Units", "Price", "Unit cost"];

/** Builds the template filled with the budget (and a blank row for each other P&L account). Returns the .xlsx bytes. */
export async function buildBudgetWorkbook(o: { lines: BudgetLine[]; products: BudgetProduct[]; months: string[]; accounts: { key: string; cls: ClassKey; label: string }[] }): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Budget");
  ws.addRow([BUDGET_MARK.lines]);
  ws.addRow(["Key", "Account", "Class", ...o.months]);
  const rows = new Map<string, { label: string; cls: ClassKey; v: Record<string, number> }>();
  for (const l of o.lines) {
    const r = rows.get(l.key) ?? { label: l.label ?? l.key, cls: l.cls, v: {} };
    r.v[l.month] = (r.v[l.month] ?? 0) + l.amount;
    rows.set(l.key, r);
  }
  for (const a of o.accounts) if (!rows.has(a.key)) rows.set(a.key, { label: a.label, cls: a.cls, v: {} });
  for (const [k, r] of rows) ws.addRow([k, r.label, r.cls, ...o.months.map((m) => r.v[m] ?? null)]);
  ws.getColumn(1).width = 14; ws.getColumn(2).width = 34; ws.getColumn(3).width = 16;
  const wp = wb.addWorksheet("Products");
  wp.addRow([BUDGET_MARK.products]);
  wp.addRow(PROD_HEAD);
  for (const p of o.products) wp.addRow([p.product, p.category ?? "", p.month, p.units, p.price, p.unit_cost]);
  wp.getColumn(1).width = 30;
  const wr = wb.addWorksheet("Read me");
  for (const t of [
    "How to fill this budget",
    "Budget sheet: one row per account, one column per month (YYYY-MM). Amounts as the statements show them: income and costs both positive.",
    "Class must be a P&L class (revenue, cos_variable, cos_fixed, exp_variable, exp_fixed, …). Leave Key blank for a new account; it is made from the name.",
    "Products sheet: one row per product and month. Revenue = Units × Price; cost of sales = Units × Unit cost (when every product of the month has one).",
    "Do not change the first row of each sheet: it tells iReport which sheet this is.",
  ]) wr.addRow([t]);
  wr.getColumn(1).width = 120;
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

/** A month cell as YYYY-MM: text as typed, or a date (Excel turns a typed 2026-03 into one). */
const monthOf = (v: unknown) => (v instanceof Date ? `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}` : txt(v).slice(0, 7));
const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

/** Reads the budget back from the template's sheets: lines, products and every cell that couldn't be read (by row). */
export function readBudgetGrids(grids: Grid[], months: string[]): { lines: BudgetLine[]; products: BudgetProduct[]; errors: string[]; hasLines: boolean; hasProducts: boolean } {
  const lines: BudgetLine[] = [], products: BudgetProduct[] = [], errors: string[] = [];
  const inYear = new Set(months);
  const lg = grids.find((g) => txt(g.rows[0]?.[0]) === BUDGET_MARK.lines);
  const pg = grids.find((g) => txt(g.rows[0]?.[0]) === BUDGET_MARK.products);
  if (!lg && !pg) return { lines, products, hasLines: false, hasProducts: false, errors: ["This file isn't the budget template. Download the template from this page, fill it in, and upload it again."] };
  if (lg) {
    const head = (lg.rows[1] ?? []).map(txt);
    const cols = head.map((h, i) => ({ h, i })).filter((x) => x.i >= 3 && x.h);
    for (const c of cols) if (!inYear.has(c.h)) errors.push(`Column ${c.h} is not a month of this budget's year (${months[0]} to ${months[months.length - 1]}).`);
    lg.rows.slice(2).forEach((row, ri) => {
      const rowNo = ri + 3;
      const label = txt(row[1]);
      let key = txt(row[0]);
      const cls = txt(row[2]);
      if (!key && !label) return;
      if (!key) key = `@${label.toLowerCase()}`;
      // A bare account code is that account; any other prefix (a class or product line) can't come from a file.
      else if (!key.startsWith("#") && !key.startsWith("@") && key !== `cls:${cls}`) {
        if (/^[\w.\-/]+$/.test(key) && !key.includes(":")) key = `#${key}`;
        else { errors.push(`Row ${rowNo}: key "${key}" is not an account (#code, @name, cls:<its class> or a plain account code).`); return; }
      }
      if (!PL.has(cls)) { errors.push(`Row ${rowNo}: class "${cls}" is not a P&L class.`); return; }
      for (const c of cols) {
        if (!inYear.has(c.h)) continue;
        const v = row[c.i];
        if (v === null || v === undefined || txt(v) === "") continue;
        const n = cleanNum(v as never);
        if (n === null) { errors.push(`Row ${rowNo}, ${c.h}: "${txt(v)}" is not a number.`); continue; }
        if (n === 0) continue;
        // The same account and month twice adds up, as the download does.
        const k = key.slice(0, 220);
        const prev = lines.find((l) => l.key === k && l.month === c.h);
        if (prev) prev.amount = Math.round((prev.amount + n) * 100) / 100;
        else lines.push({ key: k, cls: cls as ClassKey, label: label || null, month: c.h, amount: Math.round(n * 100) / 100 });
      }
    });
  }
  if (pg) {
    pg.rows.slice(2).forEach((row, ri) => {
      const rowNo = ri + 3;
      const product = txt(row[0]);
      if (!product) return;
      const month = monthOf(row[2]);
      if (!inYear.has(month)) { errors.push(`Products row ${rowNo}: month "${month}" is not a month of this budget's year.`); return; }
      const units = cleanNum(row[3] as never), price = cleanNum(row[4] as never);
      const uc = txt(row[5]) === "" ? null : cleanNum(row[5] as never);
      if (units === null || price === null || (txt(row[5]) !== "" && uc === null)) { errors.push(`Products row ${rowNo}: units, price and unit cost must be numbers.`); return; }
      products.push({ product, category: txt(row[1]) || null, month, units, price, unit_cost: uc });
    });
  }
  return { lines, products, errors, hasLines: !!lg, hasProducts: !!pg };
}
