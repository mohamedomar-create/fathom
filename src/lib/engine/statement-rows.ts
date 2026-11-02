import type { BSCalc, ClassKey, PLCalc } from "./types";

/** The P&L lines as every statement shows them (screen, report, shared link, PDF). */
export const PL_LINES: { l: string; k: keyof PLCalc; tot?: boolean; cost?: boolean; classes?: ClassKey[]; ifAdjusted?: boolean }[] = [
  { l: "Revenue", k: "revenue", classes: ["revenue"] },
  { l: "Cost of Sales", k: "cos", cost: true, classes: ["cos_variable", "cos_fixed", "cos_depreciation"] },
  { l: "Gross Profit", k: "gross_profit", tot: true },
  { l: "Expenses", k: "expenses", cost: true, classes: ["exp_variable", "exp_fixed", "exp_depreciation"] },
  { l: "Operating Profit", k: "operating_profit", tot: true },
  { l: "Other Income", k: "other_income", classes: ["other_income"] },
  { l: "Other Expenses", k: "other_expenses", cost: true, classes: ["other_expenses"] },
  { l: "Earnings Before Interest & Tax", k: "ebit", tot: true },
  { l: "Interest Income", k: "interest_income", classes: ["interest_income"] },
  { l: "Interest Expenses", k: "interest_expenses", cost: true, classes: ["interest_expenses"] },
  { l: "Earnings Before Tax", k: "ebt", tot: true },
  { l: "Tax Expenses", k: "tax_expenses", cost: true, classes: ["tax_expenses"] },
  { l: "Earnings After Tax", k: "eat", tot: true, ifAdjusted: true },
  { l: "Adjustments (prior-period and one-off items)", k: "adjustments", cost: true, classes: ["adjustments"], ifAdjusted: true },
  { l: "Net Income", k: "net_income", tot: true },
];

/** The balance sheet lines: 0 a line, 1 a total, 2 a section heading. */
export const BS_LINES: { l: string; k?: keyof BSCalc; typ: 0 | 1 | 2 }[] = [
  { l: "ASSETS", typ: 2 }, { l: "Cash & Equivalents", k: "cash", typ: 0 }, { l: "Accounts Receivable", k: "ar", typ: 0 }, { l: "Inventory", k: "inventory", typ: 0 },
  { l: "Work In Progress", k: "wip", typ: 0 }, { l: "Other Current Assets", k: "other_ca", typ: 0 }, { l: "Total Current Assets", k: "tca", typ: 1 },
  { l: "Fixed Assets", k: "fixed_assets", typ: 0 }, { l: "Intangible Assets", k: "intangibles", typ: 0 }, { l: "Investments / Other NCA", k: "investments", typ: 0 },
  { l: "Total Non-Current Assets", k: "tnca", typ: 1 }, { l: "Total Assets", k: "ta", typ: 1 },
  { l: "LIABILITIES", typ: 2 }, { l: "Short Term Debt", k: "std", typ: 0 }, { l: "Accounts Payable", k: "ap", typ: 0 }, { l: "Tax Liability", k: "tax_liab", typ: 0 },
  { l: "Other Current Liabilities", k: "other_cl", typ: 0 }, { l: "Total Current Liabilities", k: "tcl", typ: 1 }, { l: "Long Term Debt", k: "ltd", typ: 0 },
  { l: "Other Non-Current Liabilities", k: "other_ncl", typ: 0 }, { l: "Total Non-Current Liabilities", k: "tncl", typ: 1 }, { l: "Total Liabilities", k: "tl", typ: 1 },
  { l: "EQUITY", typ: 2 }, { l: "Retained Earnings", k: "retained_earnings", typ: 0 }, { l: "Other Equity", k: "other_equity", typ: 0 }, { l: "Total Equity", k: "te", typ: 1 },
  { l: "Total Liabilities & Equity", k: "tle", typ: 1 },
];

/** The lines every reader looks for first get the strongest shade; other totals a lighter one. */
const GRAND = new Set<string>(["net_income", "ta", "tle", "net_change"]);
const TOTAL = new Set<string>([...PL_LINES.filter((r) => r.tot).map((r) => r.k), ...BS_LINES.filter((r) => r.typ === 1).map((r) => r.k!)]);
export type RowKind = "line" | "total" | "grand";
export const rowKind = (key: string): RowKind => (GRAND.has(key) ? "grand" : TOTAL.has(key) ? "total" : "line");

export type Tone = "better" | "worse" | "neutral";
const PL_COST = new Set<string>(PL_LINES.filter((r) => r.cost).map((r) => r.k));
const BS_UP_BETTER = new Set(["cash", "retained_earnings", "other_equity", "te"]);
const BS_UP_WORSE = new Set(["std", "ltd"]);
/**
 * Whether a line moved the good way against its comparison. P&L: income and profit up is better, a cost up is worse.
 * Balance sheet: cash and equity up are better, debt up is worse; other balances are neither in themselves.
 * Cash flow: more cash is better.
 */
export function lineTone(statement: "PL" | "BS" | "CF", key: string, cur: number, cmp: number | null | undefined): Tone {
  if (cmp === null || cmp === undefined || Math.abs(cur - cmp) < 1) return "neutral";
  const up = cur > cmp;
  if (statement === "PL") return PL_COST.has(key) ? (up ? "worse" : "better") : up ? "better" : "worse";
  if (statement === "CF") return up ? "better" : "worse";
  if (BS_UP_BETTER.has(key)) return up ? "better" : "worse";
  if (BS_UP_WORSE.has(key)) return up ? "worse" : "better";
  return "neutral";
}

export interface Thresholds { pct: number; amount: number }
/** A move worth a look: at least the percentage AND at least the amount (a line appearing from zero counts as a move). */
export function flagChange(cur: number, cmp: number | null | undefined, th: Thresholds): boolean {
  if (cmp === null || cmp === undefined) return false;
  const d = Math.abs(cur - cmp);
  if (d < th.amount) return false;
  return cmp === 0 ? true : (d / Math.abs(cmp)) * 100 >= th.pct;
}

/** Assets and liabilities hold positive balances; a negative one sits on the wrong side. Equity may be negative. */
const SIDED = new Set(["cash", "ar", "inventory", "wip", "other_ca", "fixed_assets", "intangibles", "investments", "std", "ap", "tax_liab", "other_cl", "ltd", "other_ncl"]);
export const wrongSide = (key: string, v: number) => SIDED.has(key) && v < -1;

export const MARK_COLORS = ["yellow", "green", "blue", "pink", "grey"] as const;
export type MarkColor = (typeof MARK_COLORS)[number];
export interface Mark { color: MarkColor; note?: string }
export interface Highlights extends Thresholds { lines: Record<string, Mark> }
export const DEFAULT_HIGHLIGHTS: Highlights = { pct: 25, amount: 50_000, lines: {} };
export const HIGHLIGHTS_KEY = "highlights";

/** A mark as stored, or null when it is not a valid one (unknown colour, note too long). */
export function markOf(x: unknown): Mark | null {
  if (!x || typeof x !== "object") return null;
  const { color, note } = x as { color?: unknown; note?: unknown };
  if (!MARK_COLORS.includes(color as MarkColor)) return null;
  if (note !== undefined && (typeof note !== "string" || note.length > 120)) return null;
  return note ? { color: color as MarkColor, note } : { color: color as MarkColor };
}

/** The company's highlight settings (kpi_config.highlights), with defaults for anything missing or invalid. */
export function highlightsOf(cfg: Record<string, unknown> | null | undefined): Highlights {
  const h = (cfg?.[HIGHLIGHTS_KEY] ?? {}) as { pct?: unknown; amount?: unknown; lines?: unknown };
  const num = (v: unknown, d: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? v : d);
  // A plain object (it is sent to the page); keys like "__proto__" are refused, and marks are read with markAt.
  const lines: Record<string, Mark> = {};
  if (h.lines && typeof h.lines === "object") for (const [k, v] of Object.entries(h.lines)) { const m = markOf(v); if (m && markKeyOk(k)) lines[k] = m; }
  return { pct: num(h.pct, DEFAULT_HIGHLIGHTS.pct, 1000), amount: num(h.amount, DEFAULT_HIGHLIGHTS.amount, 1e12), lines };
}

/** An account's mark key: "#code", or its name in lower case for an account without a code (as the account map). */
export const accountMarkKey = (a: { code?: string | null; name: string }) => (a.code && a.code.trim() ? `#${a.code.trim()}`.slice(0, 101) : `@${a.name.trim().toLowerCase()}`.slice(0, 200));

/** A mark key: a statement line ("gross_profit"), an account code ("#4110") or an uncoded account's name ("@petty cash"). */
export const markKeyOk = (k: string) => /^([a-z][a-z_]{0,39}|#[^\s].{0,99}|@[^\s].{0,198})$/s.test(k) && k !== "__proto__" && k !== "constructor";

/** A comparison balance sheet with nothing in it (no balance sheet loaded for that month) is no comparison at all. */
export const emptyBS = (b: { ta: number; tle: number } | null | undefined) => !b || (b.ta === 0 && b.tle === 0);

/** A line's mark, read only from the company's own keys (never "constructor" or "toString" from the object itself). */
export const markAt = (lines: Record<string, Mark> | undefined, key: string): Mark | null => (lines && Object.hasOwn(lines, key) ? lines[key] : null);
