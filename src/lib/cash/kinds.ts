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

// Words, English and Arabic (spelled as normAr spells them), checked in this order: the first match wins. Phrases are
// narrow on purpose: how a customer paid ("InstaPay transfer", "تحويل فودافون كاش") is not what the entry is, and a
// business named "Capital Pharmacy" is a customer, not the owner's money. When unsure, a plain sale or expense.
const RULES: { d: "in" | "out"; k: Kind; w: string[] }[] = [
  // Running costs of things the business owns are expenses, never equipment.
  // Hiring equipment, cleaning furniture or paying an asset manager are costs, not buying equipment.
  { d: "out", k: "expense", w: ["repair", "repairs", "maintenance", "service", "fuel", "petrol", "diesel", "gas", "insurance", "rent", "rental", "hire", "leasing", "cleaning", "fee", "fees", "صيانه", "تصليح", "اصلاح", "بنزين", "وقود", "سولار", "تامين", "ايجار", "تاجير", "نظافه", "رسوم"] },
  { d: "out", k: "loan_repayment", w: ["loan repayment", "repay loan", "repay the loan", "loan instalment", "loan installment", "قسط القرض", "قسط قرض", "سداد القرض", "سداد قرض", "اقساط القرض"] },
  { d: "in", k: "loan", w: ["loan received", "loan from", "loan drawdown", "borrowed", "قرض مستلم", "استلام قرض", "قرض من", "سلفه من"] },
  // Narrow on purpose: in contracting "the owner" (المالك) is often the client paying an invoice.
  { d: "in", k: "capital", w: ["owner capital", "capital injection", "capital from", "owner investment", "owner's money", "owners money", "راس مال", "راس المال", "تمويل من المالك", "زياده راس المال"] },
  { d: "out", k: "drawings", w: ["drawings", "owner drawings", "owner withdrawal", "owner's withdrawal", "personal use", "for the owner", "مسحوبات", "سحب شخصي", "سحب المالك", "مسحوبات شخصيه"] },
  { d: "out", k: "asset", w: ["equipment purchase", "new equipment", "furniture purchase", "new furniture", "fridge", "new machine", "machine purchase", "new laptop", "laptop purchase", "new computer", "computer purchase", "car purchase", "vehicle purchase", "asset purchase", "شراء معدات", "معدات جديده", "شراء اثاث", "ثلاجه", "شراء جهاز", "شراء سياره", "شراء ماكينه", "شراء اصول"] },
  { d: "in", k: "collection", w: ["collection", "collected from", "payment of invoice", "تحصيل", "تحصيلات", "سداد من عميل", "سداد فاتوره"] },
  { d: "in", k: "transfer", w: ["transfer from bank", "transfer from the bank", "cash from bank", "cash from the bank", "withdrawn from bank", "withdrawal from bank", "atm withdrawal", "cash from atm", "bank withdrawal", "cash withdrawal", "between accounts", "own account", "سحب من البنك", "سحب نقدي"] },
  { d: "out", k: "transfer", w: ["deposit to bank", "deposited to bank", "deposited in bank", "bank deposit", "between accounts", "own account", "ايداع بالبنك", "ايداع بنكي", "ايداع في البنك"] },
  { d: "out", k: "purchase", w: ["purchase", "purchases", "stock", "goods", "inventory", "merchandise", "مشتريات", "بضاعه", "شراء بضاعه", "مخزون"] },
  { d: "in", k: "other_income", w: ["interest", "other income", "rent received", "فوائد", "فايده", "ايراد اخر", "ايرادات اخري"] },
];

const words = (s: string) => ` ${normAr(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

/** The kind an entry's words suggest; a plain sale (money in) or expense (money out) when nothing else fits. */
export function detectKind(d: "in" | "out", text: string): Kind {
  const t = words(text);
  for (const r of RULES) if (r.d === d && r.w.some((w) => t.includes(` ${words(w).trim()} `))) return r.k;
  return d === "in" ? "sale" : "expense";
}
