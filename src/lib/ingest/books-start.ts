// The day a company's books start in Odoo (its go-live). Odoo dates the opening journal entry on the day before, and
// assets may carry depreciation posted for months before it: none of that is trading. Everything dated before the books
// start is the opening balance, so the month before holds the opening balance sheet and trading starts on the day.
import type { LedgerEntry, RawLine } from "./extract";
import { fmtDay } from "./odoo";

/** Odoo's own name for the opening move, and the labels accountants give its lines. */
const OPENING_REF = /^(opening journal entry|قيد افتتاحي|القيد الافتتاحي)$/i;
const OPENING_LABEL = /\bopening balance\b|رصيد افتتاحي|الرصيد الافتتاحي/i;

export interface BooksStart {
  /** The day after Odoo's opening entry, when the file holds one dated on a month end. */
  suggested: string | null;
  /** The opening entry's day. */
  day: string | null;
  /** The books start used for this read, when one was given. */
  applied: string | null;
  /** Ledger lines dated before it, read into the opening balances. */
  entries: number;
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The day after the earliest opening entry, when that entry falls on a month end (Odoo's convention). */
export function suggestBooksStart(raw: RawLine[]): { suggested: string | null; day: string | null } {
  let byRef: string | null = null, byLabel: string | null = null;
  for (const r of raw) for (const e of r.entries ?? []) {
    if (OPENING_REF.test(e.ref.trim()) && (!byRef || e.day < byRef)) byRef = e.day;
    if (OPENING_LABEL.test(e.label) && (!byLabel || e.day < byLabel)) byLabel = e.day;
  }
  const day = byRef ?? byLabel;
  if (!day) return { suggested: null, day: null };
  const next = nextDay(day);
  return { suggested: next.endsWith("-01") ? next : null, day };
}

/**
 * Lines as read from the books start: movement lines take everything dated before it into their opening balance; figures
 * presented by month (a P&L or balance sheet by column) keep only the months from it. The month of the start is the first
 * month read, so the start is taken as the first day of its month.
 */
export function applyBooksStart(raw: RawLine[], start: string | undefined): { lines: RawLine[]; entries: number } {
  if (!start) return { lines: raw, entries: 0 };
  const month = start.slice(0, 7);
  let entries = 0;
  const lines = raw.map((r) => {
    const values = { ...r.values };
    let opening = r.opening;
    for (const p of Object.keys(values)) if (p < month) { if (r.kind === "movement") opening += values[p]; delete values[p]; }
    const kept = (r.entries ?? []).filter((e) => e.period >= month);
    entries += (r.entries?.length ?? 0) - kept.length;
    return { ...r, values, opening, ...(r.entries ? { entries: kept } : {}) };
  });
  return { lines, entries };
}

/** Postings after the books start to an account that took the opening entry's balancing amount (Odoo's opening equity). */
export function openingAccountPostings(raw: RawLine[], start: string, isEquity: (r: RawLine) => boolean): { account: string; entries: LedgerEntry[] } | null {
  for (const r of raw) {
    if (!isEquity(r) || !(r.entries ?? []).some((e) => e.day < start && (OPENING_REF.test(e.ref.trim()) || OPENING_LABEL.test(e.label)))) continue;
    const late = (r.entries ?? []).filter((e) => e.day >= start);
    if (late.length) return { account: r.label, entries: late };
  }
  return null;
}

export function openingPostingsDetail(found: { account: string; entries: LedgerEntry[] }): string {
  const shown = found.entries.slice(0, 4).map((e) => `${e.ref} on ${fmtDay(e.day)} (${e.amount.toLocaleString("en-GB", { maximumFractionDigits: 2 })}${e.label ? `, "${e.label.slice(0, 60)}"` : ""})`).join("; ");
  return `${found.account} holds the opening balance, but ${found.entries.length > 1 ? `${found.entries.length} entries were` : "an entry was"} posted to it after the books started: ${shown}${found.entries.length > 4 ? "…" : ""}. They change equity directly, outside profit: check that each corrects the opening balance (approved, with its document) and is not a trading transaction.`;
}
