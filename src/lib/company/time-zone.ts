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
 * decides a stock record's month is the date of its journal entry, and in a real Odoo export (Company B, 15 Oct 2026)
 * all 63 records stamped between 9 pm and midnight on a month's last day had their journal entry on that same day, so
 * moving them to Cairo time would have put them in the wrong month.
 */
export function timeZoneOf(kpiConfig: unknown): string | null {
  const p = ((kpiConfig ?? {}) as Record<string, { timeZone?: unknown } | undefined>)[PROFILE_KEY];
  return p && typeof p.timeZone === "string" && validTimeZone(p.timeZone) ? p.timeZone : null;
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

/** The company's settings with one profile setting changed, every other setting kept. */
export function withProfile(kpiConfig: unknown, patch: { timeZone?: string | null; booksFromZero?: boolean; booksStart?: string | null }): Record<string, unknown> {
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
