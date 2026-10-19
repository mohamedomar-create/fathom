// The upload's reading, as one function the background worker runs (or the page, when the browser has no worker): the
// accounts or opening balances read from the sheets with the person's corrections, and the lines the ledger gives.
import { addMonths } from "@/lib/engine";
import type { Grid, Overrides, RawLine } from "./extract";
import { extractAll, ingestOpening, runIngest, type IngestLine, type IngestOptions, type IngestResult } from "./pipeline";
import { suggestBooksStart } from "./books-start";
import { salesFromLedger } from "./sales";
import { expensesFromLedger } from "./expenses";
import { stockFromLedger } from "./inventory";
import { ledgerCashMoves, paymentsFromLedger } from "./payments";

export interface IngestParams {
  kind: "opening" | "accounts";
  overrides: Overrides;
  opts: Omit<IngestOptions, "mapping">;
  mapping: IngestOptions["mapping"];
  /** The books start the person chose ("" = none), else the company's, else the day after Odoo's opening entry. */
  startChoice: string | undefined;
  savedStart: string | null;
  /** Opening balances: the month end the person chose, else read from the file. */
  asAtChoice: string | undefined;
}
export interface IngestOutcome {
  res: IngestResult | null; err: string | null; raw: RawLine[]; booksStart: string | null;
  /** What reading the sheets found before any class was given (shown in the file's reading panel). */
  extract: { warnings: string[]; skippedCols: string[] };
}

/** A month end ("2021-06-30") from a month ("2021-06"). */
export function monthEndOf(month: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
}
const dayBefore = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** The day an opening balances file is at: Odoo's opening entry on a month end, else the month end of its last entry. */
export function openingDayOf(raw: RawLine[]): string {
  const s = suggestBooksStart(raw);
  if (s.suggested) return dayBefore(s.suggested);
  const days = raw.flatMap((r) => (r.entries ?? []).map((e) => e.day)).sort();
  const last = days[days.length - 1] ?? new Date().toISOString().slice(0, 10);
  return monthEndOf(days.length ? last.slice(0, 7) : addMonths(last.slice(0, 7), -1));
}

export function computeIngest(grids: Grid[], p: IngestParams): IngestOutcome {
  try {
    if (p.kind === "opening") {
      const { raw, issues } = extractAll(grids, p.overrides);
      const asAt = p.asAtChoice ?? openingDayOf(raw);
      const r = ingestOpening(grids, { ...p.opts, mapping: p.mapping, asAt }, p.overrides);
      return { res: r, err: null, raw, booksStart: r.booksStart.applied, extract: { warnings: issues.warnings, skippedCols: issues.skippedCols } };
    }
    const { raw, issues } = extractAll(grids, p.overrides, undefined, p.opts.cutoff);
    const start = p.startChoice !== undefined ? p.startChoice || null : p.savedStart ?? suggestBooksStart(raw).suggested;
    const extract = { warnings: [...issues.warnings], skippedCols: [...issues.skippedCols] };
    return { res: runIngest(raw, issues, { ...p.opts, mapping: p.mapping, ...(start ? { booksStart: start } : {}) }), err: null, raw, booksStart: start, extract };
  } catch (e) {
    return { res: null, err: (e as Error).message || "The file could not be analysed.", raw: [], booksStart: null, extract: { warnings: [], skippedCols: [] } };
  }
}

/** The reading as the page gets it: the ledger's entries (often 100,000+) stay in the worker; each line says how many. */
export function slimOutcome(o: IngestOutcome): IngestOutcome {
  const slim = <T extends { entries?: unknown[]; entryCount?: number }>(l: T): T => (l.entries ? { ...l, entries: undefined, entryCount: l.entries.length } : { ...l, entryCount: l.entryCount ?? 0 });
  return { ...o, raw: o.raw.map(slim), res: o.res && { ...o.res, lines: o.res.lines.map(slim) } };
}
/** The line has ledger entries (on the page, where only their number is kept). */
export const hasEntries = (l: { entries?: unknown[]; entryCount?: number }) => (l.entryCount ?? l.entries?.length ?? 0) > 0;

/** What the ledger gives besides the figures: its sales, expense, stock and bank-and-cash lines. */
export function deriveLedgerLines(lines: IngestLine[]) {
  return { sales: salesFromLedger(lines), expenses: expensesFromLedger(lines), stock: stockFromLedger(lines), payments: paymentsFromLedger(lines, ledgerCashMoves(lines)) };
}
export type LedgerLines = ReturnType<typeof deriveLedgerLines>;
