// A draft module for a table no module knows: a field per column, each typed from its values, the money column as the
// amount, a date to put rows in months, the text columns with few values as dimensions. The person names it and confirms
// the fields; nothing is saved on the draft alone.
import { cleanNum, normAr, parseDay, type Cell } from "@/lib/ingest/parse";
import type { Piece } from "@/lib/intake/split";
import type { ModuleSpec } from "./spec";

type FieldType = ModuleSpec["fields"][number]["type"];
const MONEY = /(amount|value|total|price|cost|fee|salary|wage|pay|revenue|sales|balance|مبلغ|المبلغ|قيمة|القيمة|إجمالي|الإجمالي|سعر|تكلفة|التكلفة|رسوم|الرسوم|راتب|أجر)/i;
const PERCENT = /(%|percent|percentage|rate|نسبة)/i;
const filled = (v: Cell) => v !== null && v !== undefined && String(v).trim() !== "";
const text = (v: Cell) => (v === null || v === undefined ? "" : String(v).trim());

/** The headings row: the first of the top rows whose cells are mostly words, with at least two of them. */
function headerRowOf(rows: Cell[][]): number {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] ?? []).filter(filled);
    if (cells.length >= 2 && cells.filter((v) => typeof v === "string" && cleanNum(v) === null).length >= Math.ceil(cells.length * 0.8)) return r;
  }
  return 0;
}

function slug(h: string, i: number): string {
  const s = h.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
  return /^[a-z]/.test(s) ? s : `field_${i + 1}`;
}

function typeOf(heading: string, values: Cell[]): FieldType {
  const vs = values.filter(filled);
  if (!vs.length) return "text";
  const dates = vs.filter((v) => (typeof v === "number" ? v > 20000 && v < 80000 && /date|day|تاريخ/i.test(heading) : parseDay(v) !== null)).length;
  if (dates >= vs.length * 0.8) return "date";
  // Labels mixing letters and digits (P-001, INV/2026/7) are codes even when a number can be pulled out of them.
  const coded = vs.filter((v) => typeof v === "string" && /[^\d\s.,()\-+%]/.test(v) && /\d/.test(v)).length;
  if (coded >= vs.length * 0.8 && new Set(vs.map(text)).size >= vs.length * 0.9) return "code";
  const nums = vs.filter((v) => cleanNum(v) !== null && !(typeof v === "string" && /[a-z\u0600-\u06ff]/i.test(v))).length;
  if (nums >= vs.length * 0.8) return PERCENT.test(heading) ? "percent" : MONEY.test(normAr(heading)) || vs.some((v) => { const n = cleanNum(v); return n !== null && !Number.isInteger(n); }) ? "money" : "qty";
  // Short labels with digits that are mostly different from row to row read as codes (an ID, a reference).
  const distinct = new Set(vs.map(text)).size;
  if (vs.every((v) => /\d/.test(text(v)) && text(v).length <= 30) && distinct >= vs.length * 0.9) return "code";
  return "text";
}

export function suggestSpec(p: Piece): ModuleSpec {
  const hr = headerRowOf(p.rows);
  const heads = (p.rows[hr] ?? []).map(text);
  const body = p.rows.slice(hr + 1).filter((r) => (r ?? []).some(filled));
  const used = new Set<string>();
  const fields: ModuleSpec["fields"] = [];
  heads.forEach((h, c) => {
    if (!h) return;
    let key = slug(h, c);
    while (used.has(key)) key = `${key}_${c + 1}`;
    used.add(key);
    fields.push({ key, label: { en: h.slice(0, 80), ar: h.slice(0, 80) }, type: typeOf(h, body.map((r) => r?.[c] ?? null)), heading: h.slice(0, 80), headings: [h.slice(0, 80)] });
  });
  let amount = fields.find((f) => f.type === "money")?.key;
  if (!amount) {
    // Nothing to total in money: an empty Amount field the file can add later, so the module is complete.
    fields.push({ key: "amount", label: { en: "Amount", ar: "المبلغ" }, type: "money", heading: "Amount", headings: ["amount", "المبلغ"] });
    amount = "amount";
  }
  const col = (k: string) => heads.findIndex((h, c) => h && fields.find((f) => f.key === k)?.heading === h.slice(0, 80) && c >= 0);
  const date = fields.find((f) => f.type === "date")?.key;
  const textFields = fields.filter((f) => f.type === "text");
  const dimensions = textFields.filter((f) => {
    const c = col(f.key);
    const n = new Set(body.map((r) => text(r?.[c] ?? null)).filter(Boolean)).size;
    return c >= 0 && n > 0 && n <= 30 && n < Math.max(2, body.length);
  }).map((f) => f.key).slice(0, 4);
  const measures = fields.filter((f) => (f.type === "qty" || f.type === "money" || f.type === "percent") && f.key !== amount).map((f) => f.key).slice(0, 4);
  const first = textFields[0]?.key ?? fields.find((f) => f.type === "code")?.key ?? fields[0].key;
  const name = (p.sheet || p.id || "My module").slice(0, 60);
  return {
    key: `c_${slug(name, 0).replace(/^field_1$/, "module").slice(0, 30)}`,
    name: { en: name, ar: name },
    owns: { en: `Rows of ${name}`, ar: `صفوف ${name}` },
    fields,
    required: date ? [[first], [date]] : [[first]],
    amount,
    measures, dimensions,
    ...(date ? { date } : {}),
    ...(fields.find((f) => f.type === "code") ? { doc: fields.find((f) => f.type === "code")!.key } : {}),
  };
}
