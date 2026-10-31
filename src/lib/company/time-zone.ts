import { PROFILE_KEY } from "./config-keys";

/** A name the browser's and the server's clocks both know ("Africa/Cairo", "UTC"). */
export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return /\//.test(tz) || tz === "UTC";
  } catch {
    return false;
  }
}

/**
 * The time zone a company's Odoo date-times are moved to, when its exports write them in UTC. None unless set: what
 * decides a stock record's month is the date of its journal entry, and in a real Odoo export
 * all records stamped between 9 pm and midnight on a month's last day had their journal entry on that same day, so
 * moving them to Cairo time would have put them in the wrong month.
 */
export function timeZoneOf(kpiConfig: unknown): string | null {
  const p = ((kpiConfig ?? {}) as Record<string, { timeZone?: unknown } | undefined>)[PROFILE_KEY];
  return p && typeof p.timeZone === "string" && validTimeZone(p.timeZone) ? p.timeZone : null;
}

/** The VAT rate the company set for debtor and creditor days (0.14 = 14%); undefined when it never set one. */
export function vatRateOf(kpiConfig: unknown): number | undefined {
  const v = ((kpiConfig ?? {}) as Record<string, { vatRate?: unknown } | undefined>)[PROFILE_KEY]?.vatRate;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 0.5 ? v : undefined;
}

/** The company said its books start from zero: no history before its first month, so no opening balance is due. */
export function booksFromZeroOf(kpiConfig: unknown): boolean {
  return ((kpiConfig ?? {}) as Record<string, { booksFromZero?: unknown } | undefined>)[PROFILE_KEY]?.booksFromZero === true;
}

/** The day the company's books start in Odoo ("2021-07-01"): everything dated before it is the opening balance. */
export function booksStartOf(kpiConfig: unknown): string | null {
  const v = ((kpiConfig ?? {}) as Record<string, { booksStart?: unknown } | undefined>)[PROFILE_KEY]?.booksStart;
  return typeof v === "string" && /^\d{4}-\d{2}-01$/.test(v) ? v : null;
}

/** The day the company's opening balances are at ("2021-06-30"), when they were uploaded on their own. */
export function openingAsAtOf(kpiConfig: unknown): string | null {
  const v = ((kpiConfig ?? {}) as Record<string, { openingAsAt?: unknown } | undefined>)[PROFILE_KEY]?.openingAsAt;
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** The company's settings with one profile setting changed, every other setting kept. */
export function withProfile(kpiConfig: unknown, patch: { timeZone?: string | null; booksFromZero?: boolean; booksStart?: string | null; openingAsAt?: string | null; vatRate?: number | null; compareWith?: string | null; controlAccounts?: { receivable?: string[]; payable?: string[] }; tbCheck?: TbCheck | null }): Record<string, unknown> {
  const cfg = { ...((kpiConfig ?? {}) as Record<string, unknown>) };
  cfg[PROFILE_KEY] = { ...((cfg[PROFILE_KEY] ?? {}) as Record<string, unknown>), ...patch };
  return cfg;
}

/** The company's settings with the time zone set (null: back to the default). */
export function withTimeZone(kpiConfig: unknown, tz: string | null): Record<string, unknown> {
  const cfg = { ...((kpiConfig ?? {}) as Record<string, unknown>) };
  cfg[PROFILE_KEY] = { ...((cfg[PROFILE_KEY] ?? {}) as Record<string, unknown>), timeZone: tz };
  return cfg;
}

/** The company this one took its settings from (the uploads of the same books), to compare figures with. */
export function compareWithOf(kpiConfig: unknown): string | null {
  const v = ((kpiConfig ?? {}) as Record<string, { compareWith?: unknown } | undefined>)[PROFILE_KEY]?.compareWith;
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/** The accounts the company's ageing reports are kept on (its choice), by side; empty when none was chosen. */
export function controlAccountsOf(kpiConfig: unknown): { receivable?: string[]; payable?: string[] } {
  const v = ((kpiConfig ?? {}) as Record<string, { controlAccounts?: unknown } | undefined>)[PROFILE_KEY]?.controlAccounts as Record<string, unknown> | undefined;
  const codes = (x: unknown) => (Array.isArray(x) ? x.filter((c): c is string => typeof c === "string" && c.length > 0 && c.length <= 40).slice(0, 20) : undefined);
  return { ...(codes(v?.receivable)?.length ? { receivable: codes(v?.receivable) } : {}), ...(codes(v?.payable)?.length ? { payable: codes(v?.payable) } : {}) };
}

/** A Trial Balance read against the books (never saved as data): when, which file, the months compared, the differences. */
export interface TbCheck { at: string; file: string; months: string[]; diffs: { period: string; account: string; books: number; file: number; diff: number }[] }

/** The last Trial Balance check kept for the company, or null when none was kept (or what is kept is not one). */
export function tbCheckOf(kpiConfig: unknown): TbCheck | null {
  const v = ((kpiConfig ?? {}) as Record<string, { tbCheck?: unknown } | undefined>)[PROFILE_KEY]?.tbCheck as Partial<TbCheck> | undefined;
  if (!v || typeof v.at !== "string" || typeof v.file !== "string" || !Array.isArray(v.months) || !Array.isArray(v.diffs)) return null;
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const diffs = v.diffs.filter((d) => d && typeof d.period === "string" && typeof d.account === "string" && num(d.books) && num(d.file) && num(d.diff));
  return { at: v.at, file: v.file, months: v.months.filter((m): m is string => typeof m === "string"), diffs };
}
