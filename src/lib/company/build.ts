import { addMonths, BS_KEYS, PL_KEYS, type BSInput, type ClassKey, type MonthData, type PLInput } from "@/lib/engine";
import type { AccountLine } from "./types";

export const CREDIT_CLASSES = new Set<ClassKey>(["revenue", "other_income", "interest_income", "std", "ap", "tax_liab", "other_cl", "ltd", "other_ncl", "retained_earnings", "other_equity"]);
export const PL_SET = new Set<string>(PL_KEYS);
export const isPL = (c: string) => PL_SET.has(c);
export const ALL_CLASSES: ClassKey[] = [...PL_KEYS, ...BS_KEYS];

/** Raw (debit-positive) → natural presentation sign for a class. */
export const toNatural = (cls: ClassKey, raw: number) => (CREDIT_CLASSES.has(cls) ? -raw : raw);
export const toRaw = toNatural; // the conversion is its own inverse

export interface StoredAccount { id: string; code: string; name: string; cls: ClassKey; raw: Record<string, number> }

export function naturalAccounts(stored: StoredAccount[]): AccountLine[] {
  return stored.map((a) => ({
    id: a.id, code: a.code, name: a.name, cls: a.cls,
    amounts: Object.fromEntries(Object.entries(a.raw).map(([p, v]) => [p, toNatural(a.cls, v)])),
  }));
}

/** Continuous list of months between the first and last period that has any balance. */
export function periodRange(accounts: AccountLine[]): string[] {
  const ps = new Set<string>();
  for (const a of accounts) for (const p of Object.keys(a.amounts)) ps.add(p);
  const sorted = [...ps].sort();
  if (!sorted.length) return [];
  const out: string[] = [];
  for (let p = sorted[0]; p <= sorted[sorted.length - 1]; p = addMonths(p, 1)) out.push(p);
  return out;
}

/** Aggregate natural-sign accounts into the 30 classes per month (engine input). */
export function buildMonths(accounts: AccountLine[]): MonthData[] {
  const periods = periodRange(accounts);
  return periods.map((period) => {
    const pl: PLInput = {}, bs: BSInput = {};
    for (const a of accounts) {
      const v = a.amounts[period] ?? 0;
      if (!v) continue;
      if (isPL(a.cls)) pl[a.cls as keyof PLInput] = (pl[a.cls as keyof PLInput] ?? 0) + v;
      else bs[a.cls as keyof BSInput] = (bs[a.cls as keyof BSInput] ?? 0) + v;
    }
    return { period, pl, bs };
  });
}
