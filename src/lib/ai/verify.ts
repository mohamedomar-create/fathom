/**
 * The figure check for AI text: every number in an answer must be one of the facts the system gave the AI, as rounded
 * as it is written ("1.23M" may stand for 1,234,568; "1.3M" may not). Years and small counts (up to 31: days, months,
 * a date) are words, not figures, and are let through. An answer that fails is not shown.
 */
export interface Fact { id: string; label: string; value: number; unit: "EGP" | "%" | "days" | "ratio" | "count" }

const AR: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9", "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9", "٬": ",", "٫": "." };
const NUM = /(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?([KkMm])(?![A-Za-z؀-ۿ]))?/g;

/** Each number written in the text, with the step it was rounded to (1.23M: 10,000). */
function read(text: string): { value: number; step: number }[] {
  const t = text.replace(/[٠-٩۰-۹٬٫]/g, (c) => AR[c] ?? c);
  const out: { value: number; step: number }[] = [];
  for (const m of t.matchAll(NUM)) {
    const whole = m[1].replace(/,/g, ""), dec = m[2] ?? "";
    const mult = m[3] ? (m[3].toLowerCase() === "k" ? 1e3 : 1e6) : 1;
    out.push({ value: Number(`${whole}${dec ? `.${dec}` : ""}`) * mult, step: 10 ** -dec.length * mult });
  }
  return out;
}

export const numbersIn = (text: string): number[] => read(text).map((n) => Math.round(n.value * 1e6) / 1e6);

export function verifyFigures(text: string, facts: Fact[]): { ok: boolean; unknown: number[] } {
  const candidates = facts.flatMap((f) => (f.unit === "ratio" ? [f.value, f.value * 100] : [f.value]));
  const unknown: number[] = [];
  for (const n of read(text)) {
    const isWord = Number.isInteger(n.value) && n.step === 1 && (n.value <= 31 || (n.value >= 1900 && n.value <= 2100));
    if (isWord) continue;
    const tol = Math.max(n.step / 2, 0.5 * Math.min(1, n.step)) + 1e-9;
    if (!candidates.some((v) => Math.abs(Math.abs(v) - n.value) <= tol)) unknown.push(Math.round(n.value * 1e6) / 1e6);
  }
  return { ok: unknown.length === 0, unknown };
}
