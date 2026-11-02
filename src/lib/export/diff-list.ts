import type { Sheet } from "./company-workbook";

export interface DiffRow { period: string; account: string; books: number; file: number; diff: number }
export interface DiffLabels { month: string; account: string; books: string; file: string; difference: string; months: string; list: string; summary: string }
const EN: DiffLabels = { month: "Month", account: "Account", books: "Books", file: "File", difference: "Difference", months: "Months", list: "Differences", summary: "Summary by account" };
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A difference list as a workbook, in full: every row, then a summary by account (the months it differs in and its
 * totals), largest difference first. The summary's totals add up to the list's.
 */
export function diffSheets(rows: DiffRow[], labels: DiffLabels = EN): [Sheet, Sheet] {
  const list: Sheet = { name: labels.list, rows: [[labels.month, labels.account, labels.books, labels.file, labels.difference], ...rows.map((d) => [d.period, d.account, d.books, d.file, d.diff])] };
  const by = new Map<string, { months: Set<string>; books: number; file: number; diff: number }>();
  for (const d of rows) {
    const a = by.get(d.account) ?? { months: new Set<string>(), books: 0, file: 0, diff: 0 };
    a.months.add(d.period); a.books += d.books; a.file += d.file; a.diff += d.diff;
    by.set(d.account, a);
  }
  const sum = [...by.entries()].sort((x, y) => Math.abs(y[1].diff) - Math.abs(x[1].diff) || x[0].localeCompare(y[0]));
  const summary: Sheet = { name: labels.summary, rows: [[labels.account, labels.months, labels.books, labels.file, labels.difference], ...sum.map(([acc, a]) => [acc, a.months.size, r2(a.books), r2(a.file), r2(a.diff)])] };
  return [list, summary];
}
