import { arRx, normAr, type Cell } from "./parse";
import { extractGrid, str, type Grid } from "./extract";
import { readExpenseGrid } from "./expenses";
import { readSalesGrid } from "./sales";
import { bankShape } from "./bank";
import { readCashBook } from "./cashbook";
import { templateMarkOf } from "./template";
import { otherOdooReport } from "./odoo-reports";
import { readProducts, readStockMoves, readStockOnHand, readStockValuation } from "./inventory";

/**
 * What each sheet of an upload is, decided before anything is read into the figures. iReport guesses, says why, and
 * the person can change it; sheets that are not data (price lists, summaries, notes) are named and left out on purpose.
 */
export type SheetRole = "statement" | "sales" | "bills" | "cashbook" | "bank" | "stock_valuation" | "stock_moves" | "stock_onhand" | "products" | "pricelist" | "summary" | "notes";
export const ROLE_LABEL: Record<SheetRole, string> = {
  statement: "Accounts (P&L, balance sheet, trial balance or ledger)",
  sales: "Sales list",
  bills: "Bills / expenses list",
  cashbook: "Cash book (money in and out)",
  bank: "Bank statement",
  stock_valuation: "Stock valuation (Odoo Inventory)",
  stock_moves: "Stock moves history (Odoo Inventory)",
  stock_onhand: "Stock on hand (Odoo Inventory)",
  products: "Products list (Odoo Inventory)",
  pricelist: "Price list (not imported)",
  summary: "Summary or notes (not imported)",
  notes: "No figures (not imported)",
};
export const ROLE_ORDER: SheetRole[] = ["statement", "sales", "bills", "cashbook", "bank", "stock_valuation", "stock_moves", "stock_onhand", "products", "pricelist", "summary", "notes"];
/** Roles whose figures go into iReport. */
export const IMPORTED = new Set<SheetRole>(["statement", "sales", "bills", "cashbook", "bank", "stock_valuation", "stock_moves", "stock_onhand", "products"]);
/** The sheets the Inventory module reads (and only it). */
export const INVENTORY_ROLES = new Set<SheetRole>(["stock_valuation", "stock_moves", "stock_onhand", "products"]);

export interface RoleGuess {
  sheet: string;
  role: SheetRole;
  /** False when the layout fits no reader well: the person is asked to look. */
  sure: boolean;
  why: string;
  /** Numbers on the sheet (a sheet left out with figures on it is always shown to the person). */
  figures: number;
  /** About the file itself: cells left out far from the table, cells showing spreadsheet errors. */
  notes: string[];
}

const PRICE_HDR = arRx(/^(price|prices|unit price|retail price|wholesale price|selling price|cost|unit cost|cost price|standard cost|code|sku|item code|product code|item|product|product name|سعر|السعر|سعر البيع|سعر الوحدة|التكلفة|تكلفة|كود|الكود|كود الصنف|الصنف|المنتج)\b/i);
const DATE_HDR = arRx(/^(date|التاريخ|تاريخ)$/i);

const numbers = (rows: Cell[][]) => { let n = 0; for (const r of rows) for (const v of r ?? []) if (typeof v === "number") n++; return n; };

export function guessRole(g: Grid): RoleGuess {
  const figures = numbers(g.rows);
  const notes: string[] = [];
  for (const c of g.cut ?? []) notes.push(`${c.cells.toLocaleString("en-US")} cells far to the ${c.what === "columns" ? "right" : "bottom"} of the table (${c.what} ${c.from}–${c.to}, rows ${c.rows.slice(0, 5).join(", ")}${c.rows.length > 5 ? "…" : ""}) were left out: they sit away from the table, as if pasted across the sheet.`);
  if (g.broken) notes.push(`${g.broken} cell${g.broken > 1 ? "s show" : " shows"} a spreadsheet error (#REF!, #DIV/0!…).`);
  const base = { sheet: g.name, figures, notes };
  // Odoo's other reports are named even when their amounts are text ("2,500.00 E£" in the Journal Report).
  const other = otherOdooReport(g);
  if (other) return { ...base, role: "summary", sure: true, why: `Odoo's ${other.title}: ${other.why}.` };
  if (figures < 3) return { ...base, role: "notes", sure: true, why: "No figures on this sheet." };
  const mark = templateMarkOf(g);
  if (mark === "expenses") return { ...base, role: "bills", sure: true, why: "iReport's expenses template." };
  if (mark === "sales") return { ...base, role: "sales", sure: true, why: "iReport's sales template." };
  if (mark === "pl" || mark === "bs") return { ...base, role: "statement", sure: true, why: "iReport's financials template." };
  // Odoo Inventory exports: read before the sales and bills lists (a valuation list also has dates, products and amounts).
  if (readStockValuation(g)) return { ...base, role: "stock_valuation", sure: true, why: "Odoo's stock valuation: product, quantity and value per layer." };
  if (readStockMoves(g)) return { ...base, role: "stock_moves", sure: true, why: "Odoo's moves history: product, from, to and quantity per move." };
  if (readStockOnHand(g, "2000-01-01")) return { ...base, role: "stock_onhand", sure: true, why: "Odoo's stock on hand: location, product and quantity, no dates." };
  if (readProducts(g)) return { ...base, role: "products", sure: false, why: "A products list with categories (it could also be a price list: please check)." };
  if (readExpenseGrid(g)) return { ...base, role: "bills", sure: true, why: "A list of bills: date, supplier and amount columns." };
  if (readSalesGrid(g)) return { ...base, role: "sales", sure: true, why: "A sales list: date or month, customer or product, and amount columns." };
  if (bankShape(g.rows)) return { ...base, role: "bank", sure: true, why: "Date, description, money out and in, and a balance after each line." };
  const cash = readCashBook(g);
  if (cash) {
    const L = cash.layout;
    const sides = [L.out.lines ? `money out in ${L.blocks.filter((b) => b.dir === "out").flatMap((b) => b.amounts).length} column${L.blocks.filter((b) => b.dir === "out").flatMap((b) => b.amounts).length > 1 ? "s" : ""}` : "", L.in.lines ? "money in" : ""].filter(Boolean).join(" and ");
    return { ...base, role: "cashbook", sure: true, why: `A cash book: ${sides}, by date or month heading.` };
  }
  const lines = extractGrid(g, { skippedCols: [], warnings: [] });
  if (lines.length) return { ...base, role: "statement", sure: true, why: `Accounts: ${lines.length} line${lines.length > 1 ? "s" : ""} with amounts by month.` };
  // A price list: product, code, cost and price headings and no dates.
  for (let r = 0; r < Math.min(g.rows.length, 12); r++) {
    const heads = (g.rows[r] ?? []).map((v) => normAr(str(v).toLowerCase()));
    if (heads.some((h) => DATE_HDR.test(h))) break;
    if (heads.filter((h) => h && PRICE_HDR.test(h)).length >= 2) return { ...base, role: "pricelist", sure: true, why: "Products with codes, costs or prices, and no dates: a price list." };
  }
  return { ...base, role: "summary", sure: false, why: "Figures without a layout iReport can read as entries (no month columns, no dated lines): read as a summary." };
}

export const guessRoles = (grids: Grid[]) => grids.map(guessRole);

/**
 * The person looks at the sheet list before going on when a guess is unsure, when a new kind of reading is used
 * (cash book, bank statement), or when a sheet with figures is left out.
 */
export function needsConfirm(guesses: RoleGuess[], roles: Record<string, SheetRole>) {
  return guesses.some((g) => {
    const role = roles[g.sheet] ?? g.role;
    return !g.sure || role === "cashbook" || role === "bank" || (!IMPORTED.has(role) && role !== "notes" && g.figures >= 3) || role !== g.role;
  });
}
