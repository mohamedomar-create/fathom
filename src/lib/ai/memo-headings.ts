/** The bank memo's headings in English and Arabic: the AI prompt asks for these, and the memo view recognises them. */
export const MEMO_HEADINGS = {
  en: ["Lead with", "Risks and how to answer them", "What to ask for", "Questions to expect"],
  ar: ["أبرز نقاط القوة", "المخاطر وكيفية الرد عليها", "ما الذي تطلبه", "أسئلة متوقعة"],
} as const;
/** Older wording (the automatic memo's Arabic headings). */
const ALSO = ["ابدأ بـ", "المخاطر وكيف ترد عليها"];

const RX = new RegExp(`^(${[...MEMO_HEADINGS.en, ...MEMO_HEADINGS.ar, ...ALSO].map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*:?$`, "i");
export const isMemoHeading = (line: string) => RX.test(line.trim());
