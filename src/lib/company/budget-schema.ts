import { z } from "zod";
import { PL_KEYS } from "@/lib/engine";
import type { BudgetLine } from "@/lib/engine/budget";

const Num = z.number().finite().refine((v) => Math.abs(v) < 1e15);
const Str = z.string().min(1).max(220);
const Strs = z.array(Str).max(2000);

export const SetupSchema = z.object({
  products: Strs,
  groups: z.array(z.object({ id: Str, name: Str, products: Strs, customers: Strs })).max(200),
  streams: z.object({ rental: Strs }),
  expenses: z.object({
    merged: z.array(z.object({ id: Str, name: Str, accounts: Strs })).max(500),
    excluded: Strs,
  }),
});

const Basis = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("amount"), value: Num }),
  z.object({ kind: z.literal("pct"), value: Num }),
  z.object({ kind: z.literal("units"), units: Num, price: Num }),
]);
const Cost = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unit"), value: Num }),
  z.object({ kind: z.literal("margin"), pct: Num }),
]);
export const View = z.enum(["revenue", "customer", "expense"]);

export const RowSchema = z.object({
  view: View, key: Str, label: z.string().max(200).nullable().transform((l) => l ?? ""), mode: z.enum(["year", "months"]),
  basis: Basis.nullable(), cost: Cost.nullable(), months: z.array(Num).length(12), cls: z.enum(PL_KEYS).optional(),
});

const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Line = z.object({ key: z.string().min(1).max(220), cls: z.enum(PL_KEYS), label: z.string().max(200).nullable(), month: Month, amount: Num });

/** At most this many rows and lines in one save (the database's own limit). */
export const MAX_ROWS = 20000;

export const SaveRowsSchema = z.object({
  rows: z.array(RowSchema).max(MAX_ROWS),
  views: z.array(View).min(1).refine((v) => new Set(v).size === v.length),
  lines: z.array(Line).max(MAX_ROWS).nullable(),
  setup: SetupSchema.nullable(),
});

/** True when each month's revenue line total equals the revenue rows' total for that month (within 0.01). No revenue rows: nothing to check. */
export function linesMatchRows(rows: { view: string; months: number[] }[], lines: Pick<BudgetLine, "key" | "month" | "amount">[], months: string[]): boolean {
  const rev = rows.filter((r) => r.view === "revenue");
  if (!rev.length) return true;
  return months.every((m, i) => {
    const fromRows = rev.reduce((t, r) => t + (r.months[i] ?? 0), 0);
    const fromLines = lines.reduce((t, l) => (l.key === "cls:revenue" && l.month === m ? t + l.amount : t), 0);
    return Math.abs(fromRows - fromLines) <= 0.01;
  });
}
