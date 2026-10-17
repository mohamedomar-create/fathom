"use client";
import type { SalesLine } from "@/lib/ingest/sales";
import type { ExpenseLine } from "@/lib/ingest/expenses";
import { salesLineMonths } from "@/app/company/[id]/settings/sales-actions";
import { expenseLineMonths } from "@/app/company/[id]/settings/expense-actions";
import { expenseLineText, monthPrints, planSave, salesLineText, type SaveMode } from "./month-print";
import { saveSales } from "./save-sales";
import { saveExpenses } from "./save-expenses";

export type { SaveMode };
export type SaveOutcome = { ok: true; saved: number; summary: string } | { ok: false; error: string };

const n = (x: number) => x.toLocaleString("en-US");
const months = (k: number) => `${k} month${k === 1 ? "" : "s"}`;

/**
 * Saves a file's lines the way the person chose. "Add new and changed" compares each month's fingerprint with what is
 * saved: new months are added, changed ones replaced, identical ones left alone (the same file twice saves nothing).
 * A database without fingerprints yet replaces the file's months instead, and says so.
 */
async function saveAs<T extends { period: string }>(
  lines: T[], mode: SaveMode, loaded: string[], noun: string,
  stored: () => Promise<{ ok: true; months: Record<string, { n: number; print: string }> | null } | { ok: false; error: string }>,
  text: (l: T) => string, save: (lines: T[], all: boolean) => Promise<{ ok: true; saved: number } | { ok: false; error: string }>,
): Promise<SaveOutcome> {
  if (mode === "new") {
    const keep = lines.filter((l) => !loaded.includes(l.period));
    const r = keep.length ? await save(keep, false) : { ok: true as const, saved: 0 };
    return r.ok ? { ...r, summary: `${n(r.saved)} ${noun} lines saved, new months only.` } : r;
  }
  if (!loaded.length) {
    // Nothing saved yet: every way of saving gives the same result.
    const r = await save(lines, false);
    return r.ok ? { ...r, summary: `${n(r.saved)} ${noun} lines saved.` } : r;
  }
  if (mode === "changed") {
    const s = await stored();
    if (!s.ok) return s;
    if (s.months) {
      const plan = planSave(await monthPrints(lines, text), s.months, "changed");
      const keep = lines.filter((l) => plan.periods.includes(l.period));
      const r = keep.length ? await save(keep, false) : { ok: true as const, saved: 0 };
      if (!r.ok) return r;
      const parts = [plan.added.length && `${months(plan.added.length)} added`, plan.changed.length && `${months(plan.changed.length)} changed`, plan.unchanged.length && `${months(plan.unchanged.length)} already the same, left as they were`].filter(Boolean);
      return { ...r, summary: keep.length ? `${n(r.saved)} ${noun} lines saved: ${parts.join(", ")}.` : `Nothing changed: all ${months(plan.unchanged.length)} are already saved with the same lines.` };
    }
  }
  const r = await save(lines, mode === "all");
  if (!r.ok) return r;
  return { ...r, summary: mode === "all" ? `${n(r.saved)} ${noun} lines saved. Everything saved before was replaced by this file.` : `${n(r.saved)} ${noun} lines saved; the file's months were replaced${mode === "changed" ? " (the database cannot compare months yet)" : ""}.` };
}

export function saveSalesAs(companyId: string, lines: SalesLine[], filename: string, report: Record<string, unknown>, mode: SaveMode, loaded: string[]): Promise<SaveOutcome> {
  return saveAs(lines, mode, loaded, "sales", () => salesLineMonths(companyId, "file"), salesLineText, (ls, all) => saveSales(companyId, "file", ls, filename, { ...report, mode }, { all }));
}

export function saveExpensesAs(companyId: string, lines: ExpenseLine[], filename: string, report: Record<string, unknown>, mode: SaveMode, loaded: string[]): Promise<SaveOutcome> {
  return saveAs(lines, mode, loaded, "expense", () => expenseLineMonths(companyId, "file"), expenseLineText, (ls, all) => saveExpenses(companyId, "file", ls, filename, { ...report, mode }, { all }));
}
