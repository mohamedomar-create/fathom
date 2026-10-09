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

export type Cell = string | number | boolean | Date | null | undefined;

/** '(1,234.5)' → -1234.5 ; '1.234,50-' handled ; '-' / '' → 0 ; text → null. */
export function cleanNum(v: Cell): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || v instanceof Date) return null;
  let s = arToLatin(String(v).trim());
  if (["", "-", "–", "—", "nil", "Nil", "NIL"].includes(s)) return 0;
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
export function parsePeriod(v: Cell): string | null {
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
    if (b >= 1 && b <= 12) return `${y}-${pad(b)}`; // ambiguous: assume dd/mm (Egypt/EU)
  }
  m = s.match(/^([A-Za-zéû]{3,9})[\s\-_/.,']*(\d{2,4})$/);
  if (m && MONTHS[m[1].toLowerCase()]) { let y = +m[2]; if (y < 100) y += 2000; return `${y}-${pad(MONTHS[m[1].toLowerCase()])}`; }
  m = s.match(/^(\d{2,4})[\s\-_/.,']*([A-Za-zéû]{3,9})$/);
  if (m && MONTHS[m[2].toLowerCase()]) { let y = +m[1]; if (y < 100) y += 2000; return `${y}-${pad(MONTHS[m[2].toLowerCase()])}`; }
  const ym = s.match(/(\d{4})/);
  if (ym) for (const [rx, mo] of AR_MONTHS) if (rx.test(s) && s.replace(rx, "").replace(ym[1], "").trim().length <= 2) return `${ym[1]}-${pad(mo)}`;
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
