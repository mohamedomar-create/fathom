const MONTHS: Record<string, number> = {};
["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].forEach((m, i) => (MONTHS[m] = i + 1));
["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].forEach((m, i) => (MONTHS[m] = i + 1));
MONTHS.sept = 9;
// Arabic month names (Egyptian/Levantine usage) and French (Odoo fr exports)
const AR_MONTHS: [RegExp, number][] = [
  [/يناير|كانون الثاني/, 1], [/فبراير|شباط/, 2], [/مارس|آذار/, 3], [/أبريل|ابريل|نيسان/, 4], [/مايو|أيار/, 5], [/يونيو|يونيه|حزيران/, 6],
  [/يوليو|يوليه|تموز/, 7], [/أغسطس|اغسطس|آب/, 8], [/سبتمبر|أيلول/, 9], [/أكتوبر|اكتوبر|تشرين الأول/, 10], [/نوفمبر|تشرين الثاني/, 11], [/ديسمبر|كانون الأول/, 12],
];
Object.assign(MONTHS, { janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12 });

const AR_DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "٫": ".", "٬": "," };
export const arToLatin = (s: string) => s.replace(/[٠-٩٫٬]/g, (c) => AR_DIGITS[c] ?? c);

/**
 * Arabic spelling variants written interchangeably in account names: hamza forms of alef (أ إ آ ٱ → ا), ى → ي, ة → ه,
 * ؤ → و, ئ → ي, Persian kaf/yeh, plus diacritics and the tatweel stretch (ـ). "الأصول الثابتـة" and "الاصول الثابته" match.
 */
export const normAr = (s: string) =>
  s.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/ک/g, "ك").replace(/ی/g, "ي");
/** A regular expression whose Arabic is spelled the way normAr spells text, so both sides compare alike. */
export const arRx = (rx: RegExp) => new RegExp(normAr(rx.source), rx.flags);

export type Cell = string | number | boolean | Date | null | undefined;

/** '(1,234.5)' → -1234.5 ; '1.234,50-' handled ; '-' / '' → 0 ; text → null. */
export function cleanNum(v: Cell): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v instanceof Date) return null;
  let s = arToLatin(String(v).trim());
  if (["", "-", "–", "—", "nil", "Nil", "NIL"].includes(s)) return 0;
  // Currency codes/symbols around the number ("EGP -1,234.00", "(1,234.00) ج.م", "1 234,50 €") carry no meaning here.
  s = s.replace(/[\u2212\u2013]/g, "-").replace(/[^\d.,()\-]/g, "").replace(/^[.,]+|[.,]+$/g, "");
  let neg = false;
  if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  s = s.replace(/[^\d.,]/g, "");
  if (!s || !/\d/.test(s)) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(".") > s.lastIndexOf(",") ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  const x = Number(s);
  if (!Number.isFinite(x)) return null;
  return neg ? -x : x;
}

const pad = (m: number) => String(m).padStart(2, "0");

/** Cell → 'YYYY-MM' or null. Accepts dates, 'Jan-25', 'January 2025', '2025-01', '01/2025', '31/01/2025', Arabic months. */
export type DateOrder = "dmy" | "mdy";

/** Cell → 'YYYY-MM' or null. Ambiguous numeric dates ("03/04/2026") follow `order` (day first by default, as in Egypt). */
export function parsePeriod(v: Cell, order: DateOrder = "dmy"): string | null {
  const p = parsePeriodRaw(v, order);
  if (!p) return null;
  const y = +p.slice(0, 4);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(p) && y >= 1900 && y <= 2100 ? p : null;
}

function parsePeriodRaw(v: Cell, order: DateOrder): string | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}`;
  if (typeof v === "number") return null; // bare numbers are not periods (Excel serials are converted by the reader)
  const s = arToLatin(String(v).trim());
  if (!s || s.length > 40) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?(?:[ T]00:00:00(?:\.\d+)?Z?)?$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3]; if (y < 100) y += 2000;
    if (a > 12 && b >= 1 && b <= 12) return `${y}-${pad(b)}`;
    if (b > 12 && a >= 1 && a <= 12) return `${y}-${pad(a)}`;
    if (a >= 1 && a <= 12 && b >= 1 && b <= 12) return `${y}-${pad(order === "mdy" ? a : b)}`; // ambiguous: the column's order decides
  }
  m = s.match(/^([A-Za-zéû]{3,9})[\s\-_/.,']*(\d{2,4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) { let y = +m[2]; if (y < 100) y += 2000; return `${y}-${pad(MONTHS[m[1].toLowerCase()])}`; }
  m = s.match(/^(\d{2,4})[\s\-_/.,']*([A-Za-zéû]{3,9})$/);
  if (m && MONTHS[m[2].toLowerCase()]) { let y = +m[1]; if (y < 100) y += 2000; return `${y}-${pad(MONTHS[m[2].toLowerCase()])}`; }
  const ym = s.match(/(\d{4})/);
  if (ym) for (const [rx, mo] of AR_MONTHS) if (rx.test(s) && s.replace(rx, "").replace(ym[1], "").trim().length <= 2) return `${ym[1]}-${pad(mo)}`;
  return null;
}

/**
 * Day/month order of a whole column of text dates: one "31/01/2026" or "01/31/2026" settles it for every row.
 * `order` is null when every date is ambiguous (each part ≤ 12); `sample` is the date that decided it.
 */
export function detectDateOrder(cells: Cell[]): { order: DateOrder | null; sample: string | null } {
  for (const v of cells) {
    if (typeof v !== "string") continue;
    const m = arToLatin(v.trim()).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
    if (!m) continue;
    if (+m[1] > 12 && +m[2] <= 12) return { order: "dmy", sample: v.trim() };
    if (+m[2] > 12 && +m[1] <= 12) return { order: "mdy", sample: v.trim() };
  }
  return { order: null, sample: null };
}

/** Cell → 'YYYY-MM-DD' (Date objects and numeric text dates), for "figures up to" days. */
export function parseDay(v: Cell, order: DateOrder = "dmy"): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v !== "string") return null;
  const s = arToLatin(v.trim());
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return validDay(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (!m) return null;
  let a = +m[1], b = +m[2];
  const y = +m[3] < 100 ? +m[3] + 2000 : +m[3];
  if (a > 12 || (b <= 12 && order === "dmy")) [a, b] = [b, a]; // a is now the month
  return validDay(y, a, b);
}
const validDay = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() ? `${y}-${pad(m)}-${pad(d)}` : null);

const monthsBetween = (a: string, b: string) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5) - +a.slice(5)) + 1;
const ym = (y: number, m: number) => `${y}-${pad(m)}`;

/** Numeric dates in one header share a format: decide dd/mm vs mm/dd from whichever token is unambiguous. */
function numericDates(toks: string[]): string[] | null {
  const parts = toks.map((t) => t.split(/[-/.]/).map(Number));
  if (parts.some((p) => p.length !== 3)) return null;
  const iso = parts.every((p) => p[0] > 31);
  const us = !iso && parts.some((p) => p[1] > 12);
  const out = parts.map(([a, b, c]) => {
    if (iso) return ym(a, b);
    const y = c < 100 ? c + 2000 : c;
    return us ? ym(y, a) : ym(y, b);
  });
  return out.every((p) => parsePeriod(p)) ? out : null;
}

/**
 * Column header naming a period other than a single month, as Odoo labels its report columns:
 * "From 01/01/2025 to 09/30/2025", "Jan 2025 - Sep 2025", "As of 09/30/2025", "Q3 2025", "H1 2025", "2025", "FY 2025".
 * Returns the period's last month and its length in months (balance-sheet "as of" columns count as one month).
 */
export function parsePeriodRange(v: Cell, now = new Date()): { end: string; months: number; endDay?: string } | null {
  if (typeof v !== "string") return null;
  const s = arToLatin(v.replace(/\s+/g, " ").trim());
  if (!s || s.length > 80) return null;
  const cap = (end: string, months: number) => {
    const cur = ym(now.getFullYear(), now.getMonth() + 1);
    if (end <= cur) return { end, months };
    const left = monthsBetween(cur, end) - 1; // a year-to-date column labelled with the full year
    return months - left >= 1 ? { end: cur, months: months - left } : null;
  };
  const nums = s.match(/\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/g) ?? [];
  if (nums.length === 2) {
    const d = numericDates(nums);
    const endDay = parseDay(nums[1], detectDateOrder(nums).order ?? "dmy") ?? undefined;
    if (d && d[0] <= d[1]) return { end: d[1], months: monthsBetween(d[0], d[1]), ...(endDay ? { endDay } : {}) };
  }
  if (nums.length === 1 && /\b(as of|as at|at|until|till|to|end(ing)?|closing)\b|حتى|في|إلى|الى|au\b/i.test(s)) {
    const d = numericDates(nums);
    const endDay = parseDay(nums[0], detectDateOrder(nums).order ?? "dmy") ?? undefined;
    if (d) return { end: d[0], months: 1, ...(endDay ? { endDay } : {}) };
  }
  const named = s.match(/[A-Za-zéû]{3,9}[\s\-_/.,']*\d{4}/g) ?? [];
  if (named.length === 2) {
    const [a, b] = named.map((t) => parsePeriod(t));
    if (a && b && a <= b) return { end: b, months: monthsBetween(a, b) };
  }
  let m = s.match(/^(?:Q|الربع\s*)([1-4])[\s\-_/]*(\d{4})$|^(\d{4})[\s\-_/]*Q([1-4])$/i);
  if (m) { const q = +(m[1] ?? m[4]), y = +(m[2] ?? m[3]); return cap(ym(y, q * 3), 3); }
  m = s.match(/^H([12])[\s\-_/]*(\d{4})$|^(\d{4})[\s\-_/]*H([12])$/i);
  if (m) { const h = +(m[1] ?? m[4]), y = +(m[2] ?? m[3]); return cap(ym(y, h * 6), 6); }
  m = s.match(/^(?:FY|السنة المالية|عام|سنة)?\s*(\d{4})$/i);
  if (m && +m[1] >= 1990 && +m[1] <= 2100) return cap(ym(+m[1], 12), 12);
  return null;
}

/** "400100 Product Sales" → { code: "400100", name: "Product Sales" }. */
export function splitCode(label: string): { code: string; name: string } {
  const s = label.trim();
  const m = s.match(/^\[?(\d[\d.\-]{1,14})\]?\s+[-–:]?\s*(.+)$/);
  return m ? { code: m[1], name: m[2].trim() } : { code: "", name: s };
}

export const normLabel = (s: string) => arToLatin(String(s)).replace(/^[\d.\-\s:[\]]+/, "").replace(/\s+/g, " ").trim().toLowerCase();

export function stmtFromText(t: string): "PL" | "BS" | null {
  const s = (t || "").toLowerCase();
  if (/trial|ميزان المراجعة|journal|items|ledger|أستاذ/.test(s)) return null;
  if (/balance|position|financial position|\bbs\b|ميزانية|المركز المالي/.test(s)) return "BS";
  if (/p&l|p & l|\bpl\b|profit|income|loss|operations|earnings|قائمة الدخل|الأرباح/.test(s) && !s.includes("balance")) return "PL";
  return null;
}
