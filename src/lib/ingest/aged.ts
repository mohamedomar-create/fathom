// Odoo's Aged Receivable / Aged Payable report (Accounting ▸ Reporting ▸ Aged Receivable / Aged Payable, exported to
// Excel). Read the way an accountant reads it: the as-of date, the buckets as the company's Odoo names them, one block per
// partner (a header row with the partner's totals, its open documents, "Total <partner>"), and the report's own totals at
// the top and bottom. Every figure is checked against the rows it should add up to; a row that can't be placed is an
// error, never skipped. Amounts keep Odoo's sign: positive is owed to the company (receivable) or by it (payable).
import { arToLatin, cleanNum, detectDateOrder, normAr, parseDay, type Cell, type DateOrder } from "./parse";
import type { Grid } from "./extract";

export interface AgedItem { partner: string; ref: string; memo: string; day: string | null; amounts: number[]; total: number; row: number }
export interface AgedPartner { name: string; amounts: number[]; total: number; items: number }
export interface AgedFinding { id: "no_partner" | "nets_to_zero" | "offset_buckets" | "credit_balance" | "after_as_of" | "date_order"; message: string }
export interface AgedReport {
  side: "receivable" | "payable";
  asOf: string | null;
  buckets: string[];
  partners: AgedPartner[];
  items: AgedItem[];
  total: { amounts: number[]; total: number };
  /** Figures that don't add up, or rows that can't be placed: each one blocks saving. */
  errors: string[];
  /** What an accountant would ask about: never blocks. */
  findings: AgedFinding[];
}

const BUCKET = /^(at date|not due|current|older|\d+\s*-\s*\d+|\d+\s*\+|over \d+|> ?\d+|غير مستحق|حتى تاريخه|اقدم|اكثر من \d+)$/i;
const TOTAL_HEAD = /^(total|الاجمالي|اجمالي)$/i;
const DATE_HEAD = /date|تاريخ/i;
const TOTAL_ROW = /^(total|الاجمالي|اجمالي)\s+/i;
const PAYABLE = /payable|دائن|موردين|الموردين/i;
const RECEIVABLE = /receivable|مدين|عملاء|العملاء/i;
const AS_OF = /(?:as of|as at|at|بتاريخ|حتى|في)\s*:?\s*(\S+)\s*$/i;
const NO_PARTNER = /^(unknown|no partner|غير معروف|بدون شريك)$/i;

const text = (v: Cell) => (v === null || v === undefined ? "" : String(v).replace(/\s+/g, " ").trim());
const norm = (v: Cell) => normAr(arToLatin(text(v))).toLowerCase();
const r2 = (n: number) => Math.round(n * 100) / 100 || 0;
const fmt = (n: number) => r2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const off = (a: number, b: number) => Math.abs(a - b) > 0.005;

/** "INV/2026/0001 (memo)" → ref and memo; a label with no document number ("Opening Journal Entry (Opening Balance)") too. */
function splitDoc(label: string): { ref: string; memo: string } {
  const first = label.match(/^(\S+)\s*(.*)$/)!;
  let ref: string, rest: string;
  if (/[/\\]/.test(first[1])) [ref, rest] = [first[1], first[2]];
  else { const i = label.indexOf(" ("); [ref, rest] = i > 0 ? [label.slice(0, i), label.slice(i + 1)] : [label, ""]; }
  if (rest.startsWith("(")) {
    let depth = 0, j = -1;
    for (let k = 0; k < rest.length; k++) { if (rest[k] === "(") depth++; else if (rest[k] === ")" && --depth === 0) { j = k; break; } }
    rest = j > 0 ? `${rest.slice(1, j)} ${rest.slice(j + 1)}` : rest.slice(1);
  }
  return { ref: ref.slice(0, 120), memo: rest.replace(/\s+/g, " ").trim().slice(0, 300) };
}

/** The headings row: buckets right before a Total column, an optional date column before them. */
function headings(rows: Cell[][]) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const row = rows[i] ?? [];
    const totalCol = row.findIndex((c) => TOTAL_HEAD.test(norm(c)));
    if (totalCol < 0) continue;
    const cols: number[] = [];
    for (let c = totalCol - 1; c > 0 && BUCKET.test(norm(row[c])); c--) cols.unshift(c);
    if (cols.length < 3) continue;
    const dateCol = cols[0] - 1 > 0 && DATE_HEAD.test(norm(row[cols[0] - 1])) ? cols[0] - 1 : null;
    return { row: i, cols, totalCol, dateCol, names: cols.map((c) => text(row[c])) };
  }
  return null;
}

export function readAged(g: Grid): AgedReport | null {
  const rows = g.rows;
  const h = headings(rows);
  if (!h) return null;
  const label = (i: number) => text(rows[i]?.[0]);
  const totalIdx = rows.map((_, i) => i).filter((i) => i > h.row && TOTAL_ROW.test(norm(label(i))));
  if (!totalIdx.length) return null;
  const strip = (s: string) => s.replace(/^\S+\s+/, "");
  const last = totalIdx[totalIdx.length - 1];
  const title = strip(label(last));
  const sideText = `${title} ${g.name}`;
  const side = PAYABLE.test(normAr(sideText)) ? "payable" : RECEIVABLE.test(normAr(sideText)) ? "receivable" : null;
  if (!side) return null;

  const errors: string[] = [];
  const findings: AgedFinding[] = [];
  const amounts = (i: number) => h.cols.map((c) => num(i, c));
  function num(i: number, c: number): number {
    const v = rows[i]?.[c];
    if (v === null || v === undefined || v === "") return 0;
    const n = cleanNum(v);
    if (n === null) { errors.push(`Row ${i + 1}: "${text(v)}" under "${text(rows[h!.row][c])}" is not an amount.`); return 0; }
    return n;
  }
  const sum = (xs: number[]) => r2(xs.reduce((s, x) => s + x, 0));

  // As-of date and the date order of the whole report (one unambiguous date settles it).
  const asOfText = rows.slice(0, h.row).flatMap((r) => (r ?? []).map(text)).map((t) => arToLatin(t).match(AS_OF)?.[1]).find(Boolean) ?? null;
  const dateCells: Cell[] = h.dateCol === null ? [] : rows.slice(h.row + 1).map((r) => r?.[h.dateCol!]);
  let order: DateOrder | null = detectDateOrder([asOfText, ...dateCells]).order;
  if (!order && asOfText) {
    const monthEnd = (d: string | null) => !!d && new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate() === +d.slice(8, 10);
    order = monthEnd(parseDay(asOfText, "mdy")) && !monthEnd(parseDay(asOfText, "dmy")) ? "mdy" : "dmy";
    findings.push({ id: "date_order", message: `Every date in the report could be day-first or month-first; read as ${order === "dmy" ? "day/month" : "month/day"}.` });
  }
  const asOfCell = rows.slice(0, h.row).flatMap((r) => r ?? []).find((c) => c instanceof Date);
  const asOf = asOfText ? parseDay(asOfText, order ?? "dmy") : asOfCell ? parseDay(asOfCell) : null;
  if (!asOf) errors.push(`The report's "As of" date was not found above the headings.`);

  const totalNames = new Set(totalIdx.map((i) => strip(label(i))));
  const partners: AgedPartner[] = [];
  const items: AgedItem[] = [];
  let top: number[] | null = null, topTotal = 0, bottom: number[] = h.cols.map(() => 0), bottomTotal = 0;
  let cur: { name: string; head: number[]; headTotal: number; items: AgedItem[] } | null = null;

  for (let i = h.row + 1; i < rows.length; i++) {
    const l = label(i);
    const row = rows[i] ?? [];
    const filled = row.some((c, j) => j > 0 && text(c) !== "");
    if (!l && !filled) continue;
    if (i === last) { bottom = amounts(i); bottomTotal = num(i, h.totalCol); continue; }
    if (!cur && top === null && l === title) { top = amounts(i); topTotal = num(i, h.totalCol); continue; }
    // "Total <partner>" closes the open block; a partner may itself be named "Total …" (the company, "Sample Trading Co").
    if (cur && TOTAL_ROW.test(norm(l)) && strip(l) === cur.name) {
      const name = cur.name;
      const at = amounts(i), atTotal = num(i, h.totalCol);
      h.names.forEach((b, k) => {
        const docs = sum(cur!.items.map((it) => it.amounts[k]));
        if (off(docs, at[k])) errors.push(`${name}: in "${b}" its documents add up to ${fmt(docs)}, its Total row says ${fmt(at[k])}.`);
        if (off(cur!.head[k], at[k])) errors.push(`${name}: in "${b}" its header row says ${fmt(cur!.head[k])}, its Total row says ${fmt(at[k])}.`);
      });
      if (off(sum(at), atTotal)) errors.push(`${name}: its buckets add up to ${fmt(sum(at))}, its Total says ${fmt(atTotal)}.`);
      if (off(cur.headTotal, atTotal)) errors.push(`${name}: its header row says ${fmt(cur.headTotal)} in Total, its Total row says ${fmt(atTotal)}.`);
      partners.push({ name, amounts: at.map(r2), total: r2(atTotal), items: cur.items.length });
      items.push(...cur.items);
      cur = null;
      continue;
    }
    if (!cur) {
      if (totalNames.has(l)) { cur = { name: l, head: amounts(i), headTotal: num(i, h.totalCol), items: [] }; continue; }
      if (TOTAL_ROW.test(norm(l))) { errors.push(`Row ${i + 1}: "${l}" closes a partner that was never opened.`); continue; }
      errors.push(`Row ${i + 1}: "${l || text(row.find((c) => text(c)))}" is outside any partner block.`);
      continue;
    }
    const a = amounts(i);
    const t = sum(a);
    const given = text(row[h.totalCol]) ? num(i, h.totalCol) : t;
    if (off(given, t)) errors.push(`Row ${i + 1} (${cur.name}): its buckets add up to ${fmt(t)}, its Total says ${fmt(given)}.`);
    const day = h.dateCol === null ? null : parseDay(row[h.dateCol], order ?? "dmy");
    cur.items.push({ partner: cur.name, ...splitDoc(l), day, amounts: a.map(r2), total: t, row: i });
  }
  if (cur) errors.push(`"${cur.name}" has no "Total ${cur.name}" row: the report looks cut off.`);

  h.names.forEach((b, k) => {
    const p = sum(partners.map((x) => x.amounts[k]));
    if (off(p, bottom[k])) errors.push(`The partners add up to ${fmt(p)} in "${b}", the report's total says ${fmt(bottom[k])}.`);
    if (top && off(top[k], bottom[k])) errors.push(`The report's total at the top says ${fmt(top[k])} in "${b}", at the bottom ${fmt(bottom[k])}.`);
  });
  if (off(sum(bottom), bottomTotal)) errors.push(`The report's buckets add up to ${fmt(sum(bottom))}, its total says ${fmt(bottomTotal)}.`);
  if (top && off(topTotal, bottomTotal)) errors.push(`The report's total at the top says ${fmt(topTotal)}, at the bottom ${fmt(bottomTotal)}.`);

  const who = side === "receivable" ? "customer" : "supplier";
  const list = (ps: AgedPartner[]) => ps.slice(0, 5).map((p) => p.name).join(", ") + (ps.length > 5 ? ` and ${ps.length - 5} more` : "");
  const unknown = partners.filter((p) => NO_PARTNER.test(norm(p.name)));
  if (unknown.length) findings.push({ id: "no_partner", message: `${unknown.reduce((s, p) => s + p.items, 0)} open items (${fmt(sum(unknown.map((p) => p.total)))}) have no ${who} in Odoo: they can't be chased or matched until a ${who} is set on them.` });
  const zero = partners.filter((p) => p.items > 0 && p.amounts.every((x) => !off(x, 0)));
  if (zero.length) findings.push({ id: "nets_to_zero", message: `${zero.length} ${who}${zero.length > 1 ? "s" : ""} net to zero but still have open items (${list(zero)}): the items cancel out and should be reconciled against each other in Odoo.` });
  const offset = partners.filter((p) => !off(p.total, 0) && p.amounts.some((x) => off(x, 0)));
  if (offset.length) findings.push({ id: "offset_buckets", message: `${offset.length} ${who}${offset.length > 1 ? "s" : ""} total zero while their buckets don't (${list(offset)}): an old item is offset by a newer one and the two were never matched in Odoo, so the ageing overstates both.` });
  const credit = partners.filter((p) => p.total < -0.005 && !NO_PARTNER.test(norm(p.name)));
  if (credit.length) findings.push({ id: "credit_balance", message: side === "receivable"
    ? `${credit.length} customer${credit.length > 1 ? "s" : ""} are in credit (${fmt(sum(credit.map((p) => p.total)))}): advances or payments not matched to invoices (${list(credit)}).`
    : `${credit.length} supplier${credit.length > 1 ? "s" : ""} owe the company (${fmt(sum(credit.map((p) => p.total)))}): advances or payments not matched to bills (${list(credit)}).` });
  const late = asOf ? items.filter((it) => it.day && it.day > asOf) : [];
  if (late.length) findings.push({ id: "after_as_of", message: `${late.length} document${late.length > 1 ? "s are" : " is"} dated after the report's date ${asOf} (first: ${late[0].ref}, ${late[0].day}).` });

  return { side, asOf, buckets: h.names, partners, items, total: { amounts: bottom.map(r2), total: r2(bottomTotal) }, errors, findings };
}
