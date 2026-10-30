import type { ClassKey, SubKey } from "@/lib/engine";
import { arRx, normAr, normLabel } from "./parse";

/** The classes each sub-class may sit under: a sub-class never moves an account to another class. */
export const SUB_PARENTS: Record<SubKey, ClassKey[]> = {
  interest_payable: ["other_cl", "ap", "std"],
  dividends_payable: ["other_cl", "ap"],
  income_tax_payable: ["tax_liab", "other_cl"],
  provisions: ["other_cl", "other_ncl"],
  end_of_service: ["other_ncl", "other_cl"],
  deferred_tax: ["other_ncl", "other_cl"],
  lease_liability: ["other_ncl", "other_cl", "ltd", "std"],
  rou_asset: ["fixed_assets"],
  rou_depreciation: ["cos_depreciation", "exp_depreciation"],
  disposal_gain: ["other_income", "other_expenses"],
  fx_unrealised: ["other_income", "other_expenses"],
};

export const SUB_LABEL: Record<SubKey, { en: string; ar: string }> = {
  interest_payable: { en: "Interest payable", ar: "فوائد مستحقة" },
  dividends_payable: { en: "Dividends payable", ar: "توزيعات أرباح مستحقة" },
  income_tax_payable: { en: "Income tax payable", ar: "ضريبة دخل مستحقة" },
  provisions: { en: "Provision", ar: "مخصص" },
  end_of_service: { en: "End-of-service benefits", ar: "مكافأة نهاية الخدمة" },
  deferred_tax: { en: "Deferred tax", ar: "ضريبة مؤجلة" },
  lease_liability: { en: "Lease liability", ar: "التزامات الإيجار" },
  rou_asset: { en: "Right-of-use asset", ar: "أصل حق انتفاع" },
  rou_depreciation: { en: "Right-of-use depreciation", ar: "إهلاك حق الانتفاع" },
  disposal_gain: { en: "Gain or loss on disposal", ar: "أرباح أو خسائر بيع أصول" },
  fx_unrealised: { en: "Unrealised exchange difference", ar: "فروق تقييم عملة غير محققة" },
};

// Checked in this order: the first match wins (deferred tax before income tax, end of service before provisions).
const RULES: [SubKey, RegExp][] = [
  ["rou_asset", /right of use|حق (ال)?انتفاع/],
  ["rou_depreciation", /right of use|حق (ال)?انتفاع/],
  ["lease_liability", /lease (liabilit|obligation)|finance lease|التزام(ات)? (عقود )?(ال)?(ايجار|تاجير)/],
  ["deferred_tax", /deferred tax|ضريب(ة|ه) مؤجل/],
  ["end_of_service", /end of service|gratuity|severance|نهاي(ة|ه) (ال)?خدم(ة|ه)/],
  ["income_tax_payable", /(income|corporate|corporation|profits?) tax|ضريب(ة|ه) (ال)?(دخل|ارباح)/],
  ["interest_payable", /(interest (payable|accrued|due))|accrued interest|فوائد مستحق/],
  ["dividends_payable", /dividends? (payable|declared|due)|توزيعات (ال)?ارباح مستحق|ارباح مستحق(ة|ه) للمساهمين/],
  ["provisions", /provision|مخصص/],
  ["disposal_gain", /(gains?|loss(es)?|profits?) on (the )?(sale|disposal) of (fixed |the )?(assets?|property|plant|equipment|vehicles?|cars?|machinery|buildings?|land)|(gains?|loss(es)?) on disposal|disposal of (fixed )?assets|(ارباح|خسائر|خساره|خسارة) (بيع|استبعاد) (ال)?اصول/],
  ["fx_unrealised", /unreali[sz]ed (exchange|fx|foreign|currency)|(exchange|fx|currency) (revaluation|translation)|فروق (تقييم|ترجم(ة|ه)|اعاده تقييم) (ال)?عمل(ة|ه)/],
].map(([k, rx]) => [k as SubKey, arRx(rx as RegExp)]);

const words = (s: string) => normAr(s.toLowerCase()).replace(/[()[\]{}_.,:;\-–/\\|،؛]+/g, " ").replace(/\s+/g, " ").trim();

/** The sub-class an account's name suggests, only where it fits the account's class; null when none. */
export function inferSubClass(name: string, cls: ClassKey): SubKey | null {
  const t = words(name);
  for (const [k, rx] of RULES) if (SUB_PARENTS[k].includes(cls) && rx.test(t)) return k;
  return null;
}

/** A sub-class chosen by a person, kept only where it fits the account's class. */
export const validSub = (sub: string | null | undefined, cls: ClassKey): SubKey | null =>
  sub && sub in SUB_PARENTS && SUB_PARENTS[sub as SubKey].includes(cls) ? (sub as SubKey) : null;

/**
 * Each account's sub-class: the company's choice (by "#code", then by name; "" means the person chose none), else what
 * its name suggests. A choice that does not fit the account's class is ignored.
 */
export function withSubClasses<A extends { code: string; name: string; cls: ClassKey }>(accounts: A[], map: Record<string, string> = {}): (A & { sub: SubKey | null })[] {
  return accounts.map((a) => {
    const key = mapKey(a);
    const byName = normLabel(a.name);
    const chosen = key in map ? map[key] : byName in map ? map[byName] : undefined;
    if (chosen === "") return { ...a, sub: null };
    return { ...a, sub: validSub(chosen, a.cls) ?? inferSubClass(a.name, a.cls) };
  });
}

/** The account map's key for an account: "#code", else its cleaned name (as the class choices are kept). */
export const mapKey = (a: { code: string; name: string }) => (a.code?.trim() ? `#${a.code.trim()}` : normLabel(a.name));

/** A person's sub-class choices as account map rows; a choice that does not fit the account's class is refused. */
export function subClassEntries(accounts: { id: string; code: string; name: string; cls: ClassKey }[], changes: Record<string, string>) {
  const entries: { key: string; cls: ClassKey; name: string; sub_class: string }[] = [], refused: string[] = [];
  for (const a of accounts) {
    if (!(a.id in changes)) continue;
    const want = changes[a.id];
    if (want !== "" && !validSub(want, a.cls)) { refused.push(a.name); continue; }
    entries.push({ key: mapKey(a), cls: a.cls, name: a.name, sub_class: want });
  }
  return { entries, refused };
}
