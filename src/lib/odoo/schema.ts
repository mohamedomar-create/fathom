// Every answer from Odoo is checked before iReport uses it: an answer that is not the shape Odoo sends (a text where an
// amount belongs, an absurd amount, a broken date) stops the sync and nothing is saved.
import { z, type ZodType } from "zod";
import { OdooError } from "./client";

/** Larger than any real company's balance; anything beyond it is corrupt or hostile. */
const MAX_AMOUNT = 1e15;
const amount = z.union([z.number(), z.literal(false), z.null()]).transform((x) => (typeof x === "number" ? x : 0))
  .refine((x) => Number.isFinite(x) && Math.abs(x) <= MAX_AMOUNT, "amount out of range");
const id = z.number().int().positive();
const text = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const optText = (max: number) => z.union([text(max), z.literal(false), z.null()]).transform((s) => (typeof s === "string" ? s : false as const));
const many2one = z.union([z.tuple([id, text(256)]), z.literal(false), z.null()]).transform((x) => x ?? false as const);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "not a date");

export const Version = z.object({ server_version: z.string().max(40), server_version_info: z.array(z.union([z.number(), z.string().max(20)])).max(10) });
export const CompanyRows = z.array(z.object({ id, name: text(256), currency_id: many2one })).max(10_000);
export const UserRows = z.array(z.object({ id, name: text(256), company_ids: z.array(id).max(10_000) })).length(1);
export const AccountRows = z.array(z.object({
  id, code: optText(64), name: text(256),
  account_type: z.string().max(64).optional(),
  user_type_id: many2one.optional(),
}).passthrough()).max(100_000);
export const XmlRows = z.array(z.object({ res_id: id, name: text(256) })).max(100_000);
export const GroupRows = z.array(z.object({ account_id: many2one, balance: amount }).passthrough()).max(2_000_000);
export const BalanceLines = z.array(z.object({ account_id: many2one, date: day, balance: amount })).max(5_000);
export const DetailLines = z.array(z.object({ account_id: many2one, date: day, move_id: many2one, partner_id: many2one, name: optText(512), balance: amount })).max(5_000);
export const Count = z.number().int().min(0).max(100_000_000);

/** The answer, checked; otherwise an error naming what was wrong (never the data itself). */
export function trust<S extends ZodType>(schema: S, data: unknown, what: string): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const where = issue?.path.filter((p) => typeof p === "string").join(".") || "answer";
  throw new OdooError(`Odoo sent an answer iReport can't trust (${what}: ${where}, ${issue?.message ?? "unexpected shape"}). Nothing was saved.`);
}
