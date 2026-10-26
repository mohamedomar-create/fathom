import { normAr } from "@/lib/ingest/parse";

/**
 * What a cash book entry is. Only trading kinds (sales, collections and other income in; expenses and purchases out)
 * make the business's money in and out; the owner's money, loans, transfers and equipment move cash but are not
 * earned or spent on running the business.
 */
export const IN_KINDS = ["sale", "collection", "other_income", "capital", "loan", "transfer"] as const;
export const OUT_KINDS = ["expense", "purchase", "asset", "drawings", "loan_repayment", "transfer"] as const;
export type Kind = (typeof IN_KINDS)[number] | (typeof OUT_KINDS)[number];
export const ALL_KINDS: Kind[] = [...new Set<Kind>([...IN_KINDS, ...OUT_KINDS])];

const TRADING = new Set<Kind>(["sale", "collection", "other_income", "expense", "purchase"]);
export const isTradingKind = (k: string) => TRADING.has(k as Kind);
export const kindsFor = (d: "in" | "out"): readonly Kind[] => (d === "in" ? IN_KINDS : OUT_KINDS);

export const KIND_LABEL: Record<Kind, { en: string; ar: string }> = {
  sale: { en: "Sale", ar: "مبيعات" },
  collection: { en: "Collected from a customer", ar: "تحصيل من عميل" },
  other_income: { en: "Other income", ar: "إيراد آخر" },
  capital: { en: "Owner's money in", ar: "رأس مال من المالك" },
  loan: { en: "Loan received", ar: "قرض مستلم" },
  transfer: { en: "Transfer (own accounts)", ar: "تحويل بين حساباتك" },
  expense: { en: "Expense", ar: "مصروف" },
  purchase: { en: "Stock purchase", ar: "مشتريات بضاعة" },
  asset: { en: "Equipment / asset", ar: "معدات / أصول" },
  drawings: { en: "Owner drawings", ar: "مسحوبات المالك" },
  loan_repayment: { en: "Loan repayment", ar: "سداد قرض" },
};

// Words, English and Arabic (spelled as normAr spells them), checked in this order: the first match wins.
const RULES: { d: "in" | "out"; k: Kind; w: string[] }[] = [
  { d: "out", k: "loan_repayment", w: ["loan repayment", "repay", "repayment", "instalment", "installment", "قسط", "سداد قرض", "سداد القرض", "اقساط"] },
  { d: "in", k: "loan", w: ["loan", "borrow", "قرض", "سلفه من"] },
  { d: "in", k: "capital", w: ["capital", "owner", "investment", "invested", "راس مال", "راس المال", "من المالك", "مساهمه", "تمويل من"] },
  { d: "out", k: "drawings", w: ["drawing", "drawings", "owner withdrawal", "personal", "مسحوبات", "سحب شخصي", "شخصي"] },
  { d: "out", k: "asset", w: ["equipment", "fridge", "furniture", "machine", "laptop", "computer", "car", "vehicle", "asset", "معدات", "جهاز", "اجهزه", "اثاث", "سياره", "ثلاجه", "اصول", "ماكينه"] },
  { d: "in", k: "collection", w: ["collection", "collected", "received from", "invoice", "تحصيل", "تحصيلات", "سداد من"] },
  { d: "in", k: "transfer", w: ["transfer", "from bank", "تحويل", "من البنك"] },
  { d: "out", k: "transfer", w: ["transfer", "deposit to bank", "to bank", "تحويل", "ايداع", "للبنك"] },
  { d: "out", k: "purchase", w: ["purchase", "purchases", "stock", "goods", "inventory", "مشتريات", "بضاعه", "شراء بضاعه", "مخزون"] },
  { d: "in", k: "other_income", w: ["interest", "other income", "rent received", "فوائد", "فايده", "ايراد اخر", "ايرادات اخري"] },
];

const words = (s: string) => ` ${normAr(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** The kind an entry's words suggest; a plain sale (money in) or expense (money out) when nothing else fits. */
export function detectKind(d: "in" | "out", text: string): Kind {
  const t = words(text);
  for (const r of RULES) if (r.d === d && r.w.some((w) => t.includes(` ${normAr(w)} `) || (w.includes(" ") && t.includes(normAr(w))))) return r.k;
  return d === "in" ? "sale" : "expense";
}
