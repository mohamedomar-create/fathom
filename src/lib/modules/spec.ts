// A module written as data, so it can live in the database: the catalog modules (HR, CRM…) and the modules a company
// builds from its own file. Headings are words and phrases (English, Arabic, Odoo and SAP labels) instead of RegExp, and a
// row rule is declarative. specToDef turns it into the ModuleDef the intake already reads, so a stored module goes through
// exactly the same recognition, mapping, checks, store and dashboard as every other module.
import { z } from "zod";
import { normAr } from "@/lib/ingest/parse";
import type { ClassKey } from "@/lib/engine";
import type { ModuleDef } from "./types";

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
const Bi = z.object({ en: z.string().trim().min(1).max(80), ar: z.string().trim().min(1).max(80) });
const Words = z.array(z.string().trim().min(1).max(80)).max(60);

export const ModuleSpecSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  name: Bi,
  owns: z.object({ en: z.string().trim().min(1).max(200), ar: z.string().trim().min(1).max(200) }),
  sector: z.string().regex(KEY).default("modules"),
  nature: z.enum(["flow", "snapshot"]).default("flow"),
  fields: z.array(z.object({
    key: z.string().regex(KEY),
    label: Bi,
    type: z.enum(["date", "month", "money", "qty", "percent", "text", "code"]),
    heading: z.string().trim().min(1).max(80),
    headings: Words.min(1),
  })).min(2).max(40),
  required: z.array(z.array(z.string().regex(KEY)).min(1).max(5)).min(1).max(10),
  amount: z.string().regex(KEY),
  signature: z.array(z.array(z.string().regex(KEY)).min(1).max(5)).max(5).optional(),
  measures: z.array(z.string().regex(KEY)).max(8).default([]),
  dimensions: z.array(z.string().regex(KEY)).max(8).default([]),
  sheetWords: Words.optional(),
  excludes: Words.optional(),
  party: z.string().regex(KEY).optional(),
  doc: z.string().regex(KEY).optional(),
  date: z.string().regex(KEY).optional(),
  /** A row is left out when a field holds one of these values (a cancelled order, a terminated employee). */
  exclude: z.array(z.object({ field: z.string().regex(KEY), values: Words.min(1), reason: z.string().trim().min(1).max(120) })).max(5).optional(),
  ties: z.array(z.object({ key: z.string().regex(KEY), label: Bi, classes: z.array(z.string().regex(KEY)).min(1).max(12), basis: z.enum(["movement", "balance"]) })).max(5).optional(),
}).superRefine((s, ctx) => {
  const keys = new Set(s.fields.map((f) => f.key));
  if (keys.size !== s.fields.length) ctx.addIssue({ code: "custom", message: "field keys must be unique" });
  const known = (k: string | undefined, what: string) => { if (k !== undefined && !keys.has(k)) ctx.addIssue({ code: "custom", message: `${what} "${k}" is not a field` }); };
  known(s.amount, "amount");
  if (s.fields.find((f) => f.key === s.amount)?.type !== "money") ctx.addIssue({ code: "custom", message: "the amount field must be money" });
  for (const g of [...s.required, ...(s.signature ?? [])]) for (const k of g) known(k, "field");
  for (const k of [...s.measures, ...s.dimensions]) known(k, "field");
  known(s.party, "party"); known(s.doc, "doc"); known(s.date, "date");
  for (const r of s.exclude ?? []) known(r.field, "exclude field");
});
export type ModuleSpec = z.input<typeof ModuleSpecSchema>;

const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A heading list as the whole-heading match the intake uses: case-insensitive, Arabic letters normalised. */
export function wordsRx(words: string[], whole = true): RegExp {
  const alts = [...new Set(words.map((w) => normAr(w.trim().replace(/\s+/g, " ").toLowerCase())).filter(Boolean))].map(esc);
  return new RegExp(whole ? `^(${alts.join("|")})$` : `(${alts.join("|")})`, "i");
}

export function specToDef(input: ModuleSpec): ModuleDef {
  const s = ModuleSpecSchema.parse(input);
  const rules = (s.exclude ?? []).map((r) => ({ field: r.field, values: new Set(r.values.map((v) => normAr(v.toLowerCase()))), reason: r.reason }));
  return {
    key: s.key, name: s.name, owns: s.owns, sector: s.sector, storage: "generic", nature: s.nature,
    fields: s.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, heading: f.heading, headings: wordsRx([f.heading, ...f.headings]) })),
    required: s.required, amount: s.amount,
    ...(s.signature ? { signature: s.signature } : {}),
    ...(s.sheetWords ? { sheetWords: wordsRx(s.sheetWords, false) } : {}),
    ...(s.excludes ? { excludes: wordsRx(s.excludes) } : {}),
    ...(s.party ? { party: s.party } : {}), ...(s.doc ? { doc: s.doc } : {}), ...(s.date ? { date: s.date } : {}),
    measures: s.measures, dimensions: s.dimensions,
    ...(s.ties ? { ties: s.ties.map((t) => ({ ...t, classes: t.classes as ClassKey[] })) } : {}),
    ...(rules.length ? { rowRule: (rec) => {
      for (const r of rules) { const v = rec[r.field]; if (typeof v === "string" && r.values.has(normAr(v.toLowerCase()))) return r.reason; }
      return null;
    } } : {}),
  };
}
