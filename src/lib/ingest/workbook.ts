import { normAr, normLabel, type Cell } from "./parse";
import { str, type Grid } from "./extract";
import { cellRef } from "./trace";
import type { CashLayout } from "./cashbook";
import type { SalesLine } from "./sales";
import type { ExpenseLine } from "./expenses";

/**
 * A workbook of many tabs, checked as a whole:
 *  - the owner's own summary ("Q1 sales", "Q2 expenses", "Total sales 2025", "Profit 2025"), wherever it sits, against
 *    what iReport read from every tab for those months: each figure matches, is explained (the owner's sheet counts an
 *    entry twice), or does not match (which blocks saving, like any total that does not add up);
 *  - the same entries on two tabs (a copied tab counts everything twice);
 *  - months that two tabs both cover.
 */
export interface TieRow {
  sheet: string; row: number; col: number;
  label: string;
  side: "sales" | "expenses" | "profit";
  scope: string;
  months: string[];
  file: number;
  read: number;
  /** ok · explained (the owner's sheet counts an entry twice) · bad (in a summary table whose other figures match: blocks) · alone (a lone figure, perhaps a target). */
  status: "ok" | "explained" | "bad" | "alone";
  why?: string;
}
export interface Duplicate { a: string; b: string; count: number; share: number; example: string }
export interface WorkbookTie { rows: TieRow[]; duplicates: Duplicate[]; overlaps: { side: "sales" | "expenses"; month: string; sheets: string[] }[] }

const QUARTER = /\b(?:q|quarter|qtr)\s*([1-4])\b|\b([1-4])(?:st|nd|rd|th)\s+quarter\b/i;
const AR_QUARTER: [RegExp, number][] = [[/الربع الاول/, 1], [/الربع الثاني/, 2], [/الربع الثالث/, 3], [/الربع الرابع/, 4]];
const SALES = /\b(sales|revenues?|income|turnover)\b|مبيعات|ايرادات/i;
const COSTS = /\b(expenses?|costs?|spend(ing)?|outgoings?)\b|مصروفات|تكاليف|مصاريف/i;
const PROFIT = /\b(profit|net income|loss)\b|ربح|صافي الربح/i;
const PLAN = /\b(target|plan|planned|budget|forecast|expected|goal|remaining|projected|estimate)\b|مستهدف|خطه|موازنه|متوقع|المتبقي/i;
const YEARLY = /\b(total|year|yearly|annual|full year|ytd)\b|اجمالي|السنه|سنوي/i;

const isNum = (v: Cell) => typeof v === "number" && Number.isFinite(v);
const round2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const pad = (n: number) => String(n).padStart(2, "0");

/** What a summary label claims: which side, and which months ("Q2 sales" → sales, April–June). */
function claim(label: string, fallbackYear: number | null): { side: TieRow["side"]; scope: string; months: string[] } | null {
  const t = normAr(label.toLowerCase()).replace(/\s+/g, " ").trim();
  if (!t || t.length > 60 || PLAN.test(t)) return null;
  const side = PROFIT.test(t) ? "profit" : SALES.test(t) ? "sales" : COSTS.test(t) ? "expenses" : null;
  if (!side) return null;
  const year = Number(t.match(/\b(20\d{2})\b/)?.[1] ?? 0) || fallbackYear;
  if (!year) return null;
  const qm = t.match(QUARTER);
  const q = qm ? Number(qm[1] ?? qm[2]) : AR_QUARTER.find(([rx]) => rx.test(t))?.[1] ?? null;
  if (q) return { side, scope: `Q${q} ${year}`, months: [1, 2, 3].map((i) => `${year}-${pad((q - 1) * 3 + i)}`) };
  if (YEARLY.test(t) || /\b20\d{2}\b/.test(t)) return { side, scope: String(year), months: Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`) };
  return null;
}

export function workbookTie(opts: {
  grids: Grid[];
  /** Sheets where the owner's summary may sit (cash books and sheets left out as summaries): never accounts or lists. */
  summarySheets: Set<string>;
  layouts: CashLayout[];
  sales: SalesLine[];
  expenses: ExpenseLine[];
  /** Rows the person left out. */
  skipped?: (sheet: string, row: number) => boolean;
}): WorkbookTie {
  const { grids, layouts, sales, expenses } = opts;
  const cashSheets = new Set(layouts.map((l) => l.sheet));
  const cs = sales.filter((l) => l.src && cashSheets.has(l.src.sheet));
  const ce = expenses.filter((l) => l.src && cashSheets.has(l.src.sheet));
  const years = new Map<number, number>();
  for (const l of [...cs, ...ce]) years.set(+l.period.slice(0, 4), (years.get(+l.period.slice(0, 4)) ?? 0) + 1);
  const mainYear = [...years].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const sumIn = (ls: { period: string; amount: number }[], ms: Set<string>) => round2(ls.reduce((a, l) => a + (ms.has(l.period) ? l.amount : 0), 0));
  // Differences the owner's own sheets explain: entries their totals count twice (VAT only matters when sales are net of it).
  const netSheets = new Set(layouts.filter((l) => l.blocks.some((b) => b.dir === "in" && b.vatMode === "owner-net")).map((l) => l.sheet));
  const explained = layouts.flatMap((l) => l.twice.filter((t) => !t.vat || netSheets.has(l.sheet)).map((t) => ({ ...t, sheet: l.sheet })));

  const rows: TieRow[] = [];
  if (cs.length || ce.length) {
    for (const g of grids) {
      if (!opts.summarySheets.has(g.name)) continue;
      const layout = layouts.find((l) => l.sheet === g.name);
      g.rows.forEach((row, r) => {
        if (!row || opts.skipped?.(g.name, r)) return;
        // Rows read as entries are never the owner's summary.
        if (layout?.trace[r]?.role === "entry") return;
        row.forEach((v, c) => {
          if (typeof v !== "string") return;
          const what = claim(v, mainYear);
          if (!what) return;
          // The figure is the first number to the right, before the next words.
          let at = -1;
          for (let k = c + 1; k < Math.min(row.length, c + 5); k++) { if (isNum(row[k])) { at = k; break; } if (typeof row[k] === "string" && str(row[k])) break; }
          if (at < 0) return;
          const ms = new Set(what.months);
          if (![...cs, ...ce].some((l) => ms.has(l.period))) return;
          const s = sumIn(cs, ms), e = sumIn(ce, ms);
          const read = what.side === "sales" ? s : what.side === "expenses" ? e : round2(s - e);
          const file = row[at] as number;
          const diff = round2(read - file);
          const tol = Math.max(1, Math.abs(file) * 0.00001);
          let status: TieRow["status"] = Math.abs(diff) <= tol ? "ok" : "bad";
          let why: string | undefined;
          if (status === "bad") {
            const ex = explained.filter((x) => ms.has(x.period) && (what.side === "profit" || x.side === what.side));
            const effect = round2(ex.reduce((a, x) => a + (what.side === "profit" && x.side === "expenses" ? -x.effect : x.effect), 0));
            if (ex.length && Math.abs(effect - diff) <= tol) {
              status = "explained";
              why = `your sheet counts ${ex.map((x) => `${x.sheet.split(" › ").pop()} ${cellRef(x.row, x.col).replace("row ", "row ")}`).join(", ")} twice`;
            }
          }
          // A label that names the wrong quarter ("Profit Q3" on the Q4 tab): the figure matches another period exactly.
          if (status === "bad") {
            const y = Number(what.months[0].slice(0, 4));
            for (const [scope, list] of [...[1, 2, 3, 4].map((q) => [`Q${q} ${y}`, [1, 2, 3].map((i) => `${y}-${pad((q - 1) * 3 + i)}`)] as const), [String(y), Array.from({ length: 12 }, (_, i) => `${y}-${pad(i + 1)}`)] as const]) {
              if (scope === what.scope) continue;
              const m2 = new Set(list), s2 = sumIn(cs, m2), e2 = sumIn(ce, m2);
              const other = what.side === "sales" ? s2 : what.side === "expenses" ? e2 : round2(s2 - e2);
              if (Math.abs(other - file) <= tol) { status = "explained"; why = `the figure is exactly ${scope}'s (${fmt(other)}): the label may name the wrong period`; break; }
            }
          }
          rows.push({ sheet: g.name, row: r, col: at, label: v.trim(), side: what.side, scope: what.scope, months: what.months, file, read, status, why });
        });
      });
    }
  }

  // The same entries on two tabs: a copied tab would count them all twice.
  const keyed = new Map<string, Set<string>>();
  const add = (sheet: string, k: string) => { (keyed.get(sheet) ?? keyed.set(sheet, new Set()).get(sheet)!).add(k); };
  for (const l of sales) if (l.src) add(l.src.sheet, `s|${l.period}|${l.amount}|${normLabel(l.customer)}`);
  for (const l of expenses) if (l.src) add(l.src.sheet, `e|${l.period}|${l.amount}|${normLabel(l.label)}`);
  const sheets = [...keyed.keys()];
  const duplicates: Duplicate[] = [];
  for (let i = 0; i < sheets.length; i++) for (let j = i + 1; j < sheets.length; j++) {
    const A = keyed.get(sheets[i])!, B = keyed.get(sheets[j])!;
    const both = [...A].filter((k) => B.has(k));
    if (both.length < 2) continue;
    const share = both.length / Math.min(A.size, B.size);
    const [, period, amount, name] = both[0].split("|");
    duplicates.push({ a: sheets[i], b: sheets[j], count: both.length, share, example: `${name || "no name"}, ${fmt(Number(amount))} in ${period}` });
  }

  // Months two tabs both cover (a tab may hold the month before its quarter: said, not an error).
  const overlaps: WorkbookTie["overlaps"] = [];
  for (const [side, ls] of [["sales", cs], ["expenses", ce]] as const) {
    const by = new Map<string, Set<string>>();
    for (const l of ls) (by.get(l.period) ?? by.set(l.period, new Set()).get(l.period)!).add(l.src!.sheet);
    for (const [month, ss] of by) if (ss.size > 1) overlaps.push({ side, month, sheets: [...ss] });
  }
  // A mismatch blocks only inside the owner's summary table: rows close together where at least two other figures match.
  // A figure on its own that differs may be a target or a plan ("Q2 Revenue 300,000" written ahead): said, not blocking.
  for (const sheet of new Set(rows.map((x) => x.sheet))) {
    const rs = rows.filter((x) => x.sheet === sheet).sort((a, b) => a.row - b.row);
    let group: TieRow[] = [];
    const close = () => { const good = group.filter((x) => x.status === "ok" || x.status === "explained").length; for (const x of group) if (x.status === "bad" && good < 2) x.status = "alone"; group = []; };
    for (const x of rs) { if (group.length && x.row - group[group.length - 1].row > 3) close(); group.push(x); }
    close();
  }
  return { rows, duplicates, overlaps };
}

/** One line per finding, for the issue list: mismatches and copied tabs block saving; the rest are to look at. */
export function tieMessages(t: WorkbookTie) {
  const out: { severity: "error" | "check"; sheet: string; row?: number; col?: number; message: string }[] = [];
  const name = (s: string) => s.split(" › ").pop() ?? s;
  for (const r of t.rows) {
    if (r.status === "ok") continue;
    const head = `${name(r.sheet)}, ${cellRef(r.row, r.col)}: your "${r.label}" says ${fmt(r.file)}; the entries iReport read for ${r.scope} come to ${fmt(r.read)}`;
    if (r.status === "alone") { out.push({ severity: "check", sheet: r.sheet, row: r.row, col: r.col, message: `${head}. If it is a target or a plan, nothing to do; if it is meant to be your actual figure, find the entry that differs.` }); continue; }
    if (r.status === "explained") out.push({ severity: "check", sheet: r.sheet, row: r.row, col: r.col, message: r.why?.startsWith("the figure") ? `${head}. The f${r.why.slice(5)}.` : `${head}. The difference (${fmt(round2(r.read - r.file))}) is because ${r.why}.` });
    else out.push({ severity: "error", sheet: r.sheet, row: r.row, col: r.col, message: `${head} (${r.read > r.file ? "+" : ""}${fmt(round2(r.read - r.file))}). Find the entry that differs, or leave this summary row out if it is not meant to match.` });
  }
  for (const d of t.duplicates) {
    const copied = d.share >= 0.5;
    out.push({ severity: copied ? "error" : "check", sheet: d.b, message: `${name(d.a)} and ${name(d.b)} have ${d.count} identical entries (for example ${d.example}).${copied ? " One looks like a copy of the other: set one to \"Summary or notes\" under Your sheets, or everything in it is counted twice." : " Check they are not the same entries written twice."}` });
  }
  for (const o of t.overlaps) out.push({ severity: "check", sheet: o.sheets[0], message: `${o.month}: ${o.side} come from ${o.sheets.length} tabs (${o.sheets.map(name).join(", ")}). Each entry is counted once.` });
  return out;
}
