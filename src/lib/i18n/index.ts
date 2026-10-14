import { ar } from "./ar";
import { en, type Dict } from "./en";

/** The app's languages: English, and Arabic (written right to left). Figures keep Western digits in both. */
export type Lang = "en" | "ar";
export const LANGS: Lang[] = ["en", "ar"];
/** The cookie that holds the chosen language (a year; not tied to the account, so it works on the public pages too). */
export const LANG_COOKIE = "lang";

export const parseLang = (v: string | null | undefined): Lang => (v === "ar" ? "ar" : "en");
export const dirOf = (lang: Lang): "rtl" | "ltr" => (lang === "ar" ? "rtl" : "ltr");
export const htmlLang = (lang: Lang) => (lang === "ar" ? "ar-EG" : "en-GB");

const DICTS: Record<Lang, Dict> = { en, ar };
export const dict = (lang: Lang): Dict => DICTS[lang];
export type { Dict };

const MONTHS_AR = ["", "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const MONTHS_EN = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const QUARTERS_AR = ["", "الربع الأول", "الربع الثاني", "الربع الثالث", "الربع الرابع"];

/** Month names as the app shows them (index 1 = January). */
export const monthNames = (lang: Lang) => (lang === "ar" ? MONTHS_AR : MONTHS_EN);

/** "2026-09" as "Sep 2026" or "سبتمبر 2026". */
export function monthLabel(p: string, lang: Lang): string {
  const [y, m] = p.split("-").map(Number);
  return `${monthNames(lang)[m]} ${y}`;
}

/**
 * The engine's period labels ("Sep 2026", "Q3 2026", "Year 2026", "FY2026", "Q3 2026 (to Aug)") in the chosen
 * language. English labels come back unchanged.
 */
export function periodLabel(label: string, lang: Lang): string {
  if (lang === "en") return label;
  const mi = (abbr: string) => MONTHS_EN.indexOf(abbr);
  return label
    .replace(/\(to (\d+ )?(\w{3})\)/g, (_, d: string | undefined, a: string) => `(حتى ${d ?? ""}${MONTHS_AR[mi(a)] ?? a})`)
    .replace(/\bQ([1-4]) FY(\d{4})/g, (_, q: string, y: string) => `${QUARTERS_AR[Number(q)]} من السنة المالية ${y}`)
    .replace(/\bQ([1-4]) /g, (_, q: string) => `${QUARTERS_AR[Number(q)]} `)
    .replace(/\bFY(\d{4})/g, "السنة المالية $1")
    .replace(/\bYear /g, "سنة ")
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/g, (a: string) => MONTHS_AR[mi(a)]);
}
