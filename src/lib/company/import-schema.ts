import { z } from "zod";
import { ALL_CLASSES } from "@/lib/company/build";
import { CHECK_IDS } from "@/lib/company/checks";
import { mlabel } from "@/lib/engine";

/**
 * What an upload sends to be checked and saved. The limits guard the server against abuse, never real data: a General
 * Ledger can run from 2015 to today (a range column or a total covering 140+ months), with thousands of accounts and checks.
 */
export const MAX_MONTHS = 600;

export const ClassEnum = z.enum(ALL_CLASSES as [string, ...string[]]);
export const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const Ref = z.object({ sheet: z.string().max(120).optional(), row: z.number().int().min(0).optional(), label: z.string().max(300).optional() });
const CheckSchema = z.object({
  id: z.enum(CHECK_IDS),
  severity: z.enum(["block", "warn", "info"]), period: Period.optional(), statement: z.enum(["PL", "BS"]).optional(),
  title: z.string().max(200), detail: z.string().max(1000),
  expected: z.number().finite().optional(), actual: z.number().finite().optional(), diff: z.number().finite().optional(),
});
export const PlanSchema = z.object({
  companyId: z.string().uuid(),
  mode: z.enum(["merge", "add", "replace"]),
  slices: z.object({ PL: z.array(Period).max(MAX_MONTHS), BS: z.array(Period).max(MAX_MONTHS) }),
  accounts: z.array(z.object({
    code: z.string().max(40), name: z.string().min(1).max(300), cls: ClassEnum,
    amounts: z.record(Period, z.number().finite()),
    confidence: z.number().min(0).max(1).nullable().optional(),
    mapped_by: z.enum(["auto", "user", "system"]).optional(),
    ref: Ref.optional(),
  })).min(1).max(20_000),
  controls: z.array(z.object({ metric: z.enum(["revenue", "gross_profit", "net_income", "ta", "tl", "te", "tle"]), period: Period, value: z.number().finite(), source: z.string().max(400), months: z.number().int().min(1).max(MAX_MONTHS).optional() })).max(3000).default([]),
  extra: z.array(CheckSchema).max(5000).default([]),
  ranges: z.record(Period, z.number().int().min(1).max(MAX_MONTHS)).default({}),
  openingFrom: Period.nullable().default(null),
  // The day the company's books start in Odoo: everything before it is the opening balance (stored months before it go).
  booksStart: z.string().regex(/^\d{4}-\d{2}-01$/).nullable().default(null),
  // Opening balances uploaded on their own: the balance sheet at this month end.
  opening: z.object({ asAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).nullable().default(null),
});
export const ImportSchema = PlanSchema.extend({
  filename: z.string().max(300).nullable(),
  report: z.object({
    kind: z.string(), periods: z.array(Period), warnings: z.array(z.string()), notes: z.array(z.string()), flips: z.array(z.string()),
    mapping: z.record(z.string(), z.string()),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // The cut-off date chosen on the Check step: nothing dated after it was read.
    cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    // Figures read from PDF pages: how many pages, and how many figures the person corrected before importing.
    pdf: z.object({ pages: z.number().int().min(0).max(1000), corrected: z.number().int().min(0).max(100000), flagged: z.number().int().min(0).max(100000) }).optional(),
    // Corrections made in the upload's reading box: retyped cells and rows left out, with what the file held.
    fixes: z.array(z.object({
      sheet: z.string().max(200), row: z.number().int().min(0).max(10_000_000), col: z.number().int().min(0).max(100_000).optional(),
      action: z.enum(["set", "empty", "skip-row"]), value: z.union([z.number().finite(), z.string().max(120)]).optional(), was: z.string().max(120).optional(),
    })).max(500).optional(),
  }),
  accept: z.object({ keys: z.array(z.string().max(80)).max(5000), reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500) }).optional(),
});


const FIELD: Record<string, string> = { accounts: "accounts", controls: "file totals", extra: "file checks", slices: "months", fixes: "corrections", keys: "accepted checks" };

/** The refusal in plain words: which part of the upload, and why. */
export function invalidImport(err: z.ZodError, input?: unknown): string {
  const i = err.issues[0];
  if (!i) return "The import data is not valid.";
  const path = i.path.map(String);
  const max = (i as { maximum?: number | bigint }).maximum;
  if (path[0] === "ranges" && i.code === "too_big") {
    const p = path[1] ?? "";
    const sent = (input as { ranges?: Record<string, unknown> } | undefined)?.ranges?.[p];
    return `The import data is not valid: a P&L column for ${/^\d{4}-\d{2}$/.test(p) ? mlabel(p) : p} covers ${typeof sent === "number" ? sent : "too many"} months; at most ${max} can be read.`;
  }
  if (path[0] === "controls" && path.includes("months") && i.code === "too_big") return `The import data is not valid: a total in the file covers more than ${max} months.`;
  const what = FIELD[path.find((x) => FIELD[x]) ?? ""];
  if (what && i.code === "too_big") return `The import data is not valid: too many ${what} in one upload (at most ${max}). Upload fewer months or split the file.`;
  return `The import data is not valid: ${path.join(".") || "upload"}: ${i.message}`;
}
