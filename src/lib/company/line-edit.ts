import { z } from "zod";

/** One sale or expense typed into the app (Simple mode's lines table), checked before it reaches the database. */
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().max(max).optional();
const Fields = z.object({
  day: Day.optional(),
  amount: z.number().finite().optional(),
  doc: text(80),
  customer: text(200),
  product: text(300),
  category: text(200),
  supplier: text(200),
  label: text(200),
  channel: text(120),
  qty: z.number().finite().nullable().optional(),
  cost: z.number().finite().nullable().optional(),
  cls: z.enum(["exp_fixed", "exp_variable"]).optional(),
  paid: z.boolean().nullable().optional(),
  paidOn: Day.nullable().optional(),
}).strict();
const Kind = z.enum(["sales", "expenses"]);

export const NewLine = z.object({ kind: Kind, line: Fields }).superRefine((v, ctx) => {
  if (!v.line.day) ctx.addIssue({ code: "custom", path: ["line", "day"], message: "A date is needed." });
  if (v.line.amount === undefined) ctx.addIssue({ code: "custom", path: ["line", "amount"], message: "An amount is needed." });
  if (v.kind === "expenses" && !v.line.category?.trim()) ctx.addIssue({ code: "custom", path: ["line", "category"], message: "A category is needed." });
});
export const LineEdit = z.object({ kind: Kind, id: z.number().int().positive(), line: Fields });
