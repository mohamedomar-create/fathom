import * as XLSX from "@e965/xlsx";
import { sheetOf } from "./messy";

/**
 * Made-up Sales and Expenses workbooks for Simple mode (never real data: this repository is public). Each comes as an
 * .xlsx with a Sales and an Expenses sheet, and each sheet also as CSV text.
 */
type V = string | number | Date | null;
const cellsOf = (rows: V[][], top = 0): Record<string, V> => {
  const out: Record<string, V> = {};
  rows.forEach((r, i) => r.forEach((v, c) => { if (v !== null && v !== "") out[XLSX.utils.encode_cell({ r: top + i, c })] = v; }));
  return out;
};
function book(sheets: { name: string; rows: V[][]; top?: number; title?: string }[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const cells = cellsOf(s.rows, s.top ?? 0);
    if (s.title) cells.A1 = s.title;
    const ws = sheetOf(cells);
    // A title merged across the top, as a hand-kept sheet often has.
    if (s.title) ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx", cellDates: true }) as ArrayBuffer;
}
const csv = (rows: V[][]) => rows.map((r) => r.map((v) => (v === null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n");

/** Clean: every column, one heading row. Revenue 5,000, cost of sales 2,000, expenses 3,900: net profit −900. */
export const CLEAN_SALES: V[][] = [
  ["Date", "Customer", "Product", "Quantity", "Net amount", "Cost of sales", "Channel", "Paid", "Payment date"],
  ["05/01/2026", "Nile Traders", "Widget", 2, 1000, 400, "Shop", "Yes", "10/01/2026"],
  ["20/01/2026", "Delta Stores", "Gadget", 1, 500, 200, "Online", "No", ""],
  ["03/02/2026", "Nile Traders", "Widget", 4, 2000, 800, "Shop", "Yes", "03/02/2026"],
  ["14/03/2026", "Giza Market", "Gadget", 3, 1500, 600, "Online", "Yes", "20/03/2026"],
];
export const CLEAN_EXPENSES: V[][] = [
  ["Date", "Category", "Supplier", "Fixed or variable", "Amount", "Paid", "Payment date"],
  ["01/01/2026", "Rent", "Landlord", "Fixed", 1200, "Yes", "01/01/2026"],
  ["15/01/2026", "Advertising", "Social ads", "Variable", 300, "No", ""],
  ["01/02/2026", "Rent", "Landlord", "Fixed", 1200, "Yes", ""],
  ["01/03/2026", "Rent", "Landlord", "Fixed", 1200, "Yes", ""],
];

/**
 * Messy: a merged title, a blank row, headings on row 4, day-first text dates mixed with real dates, "1,234.50" stored
 * as text, a blank row between entries, a row whose date is not a date, and a total row. Three sales are read (2,500).
 */
export const MESSY_SALES: V[][] = [
  ["Date", "Customer", "Amount", "Paid"],
  ["25/01/2026", "Nile Traders", "1,234.50", "Yes"],
  [new Date(Date.UTC(2026, 1, 7)), "Delta Stores", 800, "No"],
  [null, null, null, null],
  ["soon", "Giza Market", 100, "Yes"],
  ["12/03/2026", "Nile Traders", 465.5, ""],
  ["Total", null, 2500, null],
];
export const MESSY_EXPENSES: V[][] = [
  ["Date", "Category", "Amount"],
  ["25/01/2026", "Rent", "1,200"],
  [null, null, null],
  ["26/02/2026", "Electricity", "350.75"],
  ["Total", null, "1,550.75"],
];

/** Only the minimum columns: a date and an amount for a sale; a date, a category and an amount for an expense. */
export const MINIMAL_SALES: V[][] = [["Date", "Amount"], ["15/01/2026", 900], ["15/02/2026", 1100]];
export const MINIMAL_EXPENSES: V[][] = [["Date", "Category", "Amount"], ["20/01/2026", "Rent", 700], ["20/02/2026", "Rent", 700]];

/** Arabic headings and values. */
export const ARABIC_SALES: V[][] = [
  ["التاريخ", "العميل", "المبلغ", "طريقة البيع", "مدفوع", "تاريخ الدفع"],
  ["15/01/2026", "شركة النيل", 1200, "متجر", "مدفوع", "20/01/2026"],
  ["16/01/2026", "شركة الدلتا", 800, "أونلاين", "غير مدفوع", ""],
];
export const ARABIC_EXPENSES: V[][] = [
  ["التاريخ", "البند", "المبلغ", "ثابت أو متغير", "مدفوع"],
  ["01/01/2026", "إيجار", 1000, "ثابت", "نعم"],
  ["10/01/2026", "دعاية", 250, "متغير", "لا"],
];

export const SIMPLE_FIXTURES = {
  clean: { sales: CLEAN_SALES, expenses: CLEAN_EXPENSES },
  messy: { sales: MESSY_SALES, expenses: MESSY_EXPENSES, top: 3, title: "My Shop – 2026" },
  minimal: { sales: MINIMAL_SALES, expenses: MINIMAL_EXPENSES },
  arabic: { sales: ARABIC_SALES, expenses: ARABIC_EXPENSES },
} as const;
export type FixtureName = keyof typeof SIMPLE_FIXTURES;

/** The fixture as one workbook with a Sales and an Expenses sheet. */
export function simpleBook(name: FixtureName): ArrayBuffer {
  const f = SIMPLE_FIXTURES[name] as { sales: V[][]; expenses: V[][]; top?: number; title?: string };
  return book([
    { name: name === "arabic" ? "المبيعات" : "Sales", rows: f.sales, top: f.top, title: f.title },
    { name: name === "arabic" ? "المصروفات" : "Expenses", rows: f.expenses, top: f.top, title: f.title },
  ]);
}
/** One sheet of the fixture as an .xlsx on its own (an upload of just the Sales or just the Expenses file). */
export function simpleSheet(name: FixtureName, kind: "sales" | "expenses"): ArrayBuffer {
  const f = SIMPLE_FIXTURES[name] as { sales: V[][]; expenses: V[][]; top?: number; title?: string };
  return book([{ name: kind === "sales" ? "Sales" : "Expenses", rows: f[kind], top: f.top, title: f.title }]);
}
/** One sheet of the fixture as CSV text (real dates written day-first, as a spreadsheet saves them). */
export function simpleCsv(name: FixtureName, kind: "sales" | "expenses"): string {
  const f = SIMPLE_FIXTURES[name] as { sales: V[][]; expenses: V[][] };
  const dmy = (v: V) => (v instanceof Date ? `${String(v.getUTCDate()).padStart(2, "0")}/${String(v.getUTCMonth() + 1).padStart(2, "0")}/${v.getUTCFullYear()}` : v);
  return csv(f[kind].map((r) => r.map(dmy)));
}
