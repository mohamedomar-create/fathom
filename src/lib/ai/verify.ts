/**
 * The figure check for AI text: every number in an answer must be one of the facts the system gave the AI, as rounded
 * as it is written ("1.23M" may stand for 1,234,568; "1.3M" may not), and never looser than 1% of the figure. A number
 * written negative must be a negative fact. Years and small counts (up to 31: days, months, a date) are words, not
 * figures, and are let through, unless they are written as money or a percentage. An answer that fails is not shown.
 */
export interface Fact { id: string; label: string; value: number; unit: "EGP" | "%" | "days" | "ratio" | "count" }

const AR: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9", "٬": ",", "٫": "." };
const MULT: Record<string, number> = { k: 1e3, thousand: 1e3, "ألف": 1e3, "الف": 1e3, m: 1e6, mn: 1e6, million: 1e6, "مليون": 1e6, bn: 1e9, b: 1e9, billion: 1e9, "مليار": 1e9 };
const NUM = /(?<![\d.,])([-−]\s?)?(\()?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(thousand|million|billion|mn|bn|[KkMmBb]|ألف|الف|مليون|مليار)(?![A-Za-z؀-ۿ]))?(\))?/g;
const MONEY_BEFORE = /(EGP|LE|L\.E\.|USD|US\$|\$|€|£|جنيه|ج\.م)\s?$/i;
const AFTER = /^\s?(%|٪|EGP|LE|USD|جنيه|ج\.م|percent|في المائة)/i;

interface Read { value: number; step: number; asFigure: boolean }

/** Each number written in the text, signed, with the step it was rounded to (1.23M: 10,000). */
function read(text: string): Read[] {
  // "-EGP 1,234" (how amounts are written for the AI) is the negative amount.
  const t = text.replace(/[٠-٩۰-۹٬٫]/g, (c) => AR[c] ?? c).replace(/[-−]\s?(EGP|LE|USD|US\$|\$|€|£)\s?(?=\d)/gi, "-");
  const out: Read[] = [];
  for (const m of t.matchAll(NUM)) {
    const [, minus, open, int, dec = "", word, close] = m;
    const mult = word ? MULT[word.toLowerCase()] ?? 1 : 1;
    const neg = Boolean(minus) || (Boolean(open) && Boolean(close));
    const abs = Number(`${int.replace(/,/g, "")}${dec ? `.${dec}` : ""}`) * mult;
    const at = m.index ?? 0;
    const before = t.slice(Math.max(0, at - 6), at), after = t.slice(at + m[0].length, at + m[0].length + 14);
    const asFigure = neg || Boolean(dec) || Boolean(word) || int.includes(",") || MONEY_BEFORE.test(before) || AFTER.test(after);
    out.push({ value: neg ? -abs : abs, step: 10 ** -dec.length * mult, asFigure });
  }
  return out;
}

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
export const numbersIn = (text: string): number[] => read(text).map((n) => r6(Math.abs(n.value)));
/** Every number in the text with its sign: the facts the AI was given. */
export const signedNumbersIn = (text: string): number[] => read(text).map((n) => r6(n.value));

export function verifyFigures(text: string, facts: Fact[]): { ok: boolean; unknown: number[] } {
  const candidates = facts.flatMap((f) => (f.unit === "ratio" ? [f.value, f.value * 100] : [f.value]));
  const unknown: number[] = [];
  for (const n of read(text)) {
    const a = Math.abs(n.value);
    const isWord = !n.asFigure && Number.isInteger(a) && n.step === 1 && (a <= 31 || (a >= 1900 && a <= 2100));
    if (isWord) continue;
    const tol = Math.min(n.step / 2, Math.max(0.01 * a, 0.5)) + 1e-9;
    // A positive number may stand for a negative figure ("a loss of 1.2M"); a negative one must be negative.
    const ok = candidates.some((v) => (n.value < 0 ? v < 0 && Math.abs(v - n.value) <= tol : Math.abs(Math.abs(v) - a) <= tol));
    if (!ok) unknown.push(r6(n.value));
  }
  return { ok: unknown.length === 0, unknown };
}
