import { PROFILE_KEY } from "./config-keys";

/**
 * How a company uses the app. "full": every module, for companies with an accounting system's books. "simple": the
 * small-business cash book (/cash/[id]), with its own entries, pages and figures, separate from the full system.
 * Switching copies the data across once and deletes nothing. A company with no mode set is Full.
 */
export type CompanyMode = "full" | "simple";
export interface OpeningCash { amount: number; asOf: string }

const profileOf = (kpiConfig: unknown) => ((kpiConfig ?? {}) as Record<string, Record<string, unknown> | undefined>)[PROFILE_KEY] ?? {};
const withPatch = (kpiConfig: unknown, patch: Record<string, unknown>): Record<string, unknown> => {
  const cfg = { ...((kpiConfig ?? {}) as Record<string, unknown>) };
  cfg[PROFILE_KEY] = { ...((cfg[PROFILE_KEY] ?? {}) as Record<string, unknown>), ...patch };
  return cfg;
};

export function modeOf(kpiConfig: unknown): CompanyMode {
  return profileOf(kpiConfig).mode === "simple" ? "simple" : "full";
}

export const withMode = (kpiConfig: unknown, mode: CompanyMode) => withPatch(kpiConfig, { mode });

/** The cash the business held on a day: where the cash book's "cash today" starts. */
export function openingCashOf(kpiConfig: unknown): OpeningCash | null {
  const v = profileOf(kpiConfig).openingCash as Partial<OpeningCash> | undefined;
  return v && typeof v.amount === "number" && Number.isFinite(v.amount) && typeof v.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.asOf) ? { amount: v.amount, asOf: v.asOf } : null;
}

export const withOpeningCash = (kpiConfig: unknown, cash: OpeningCash | null) => withPatch(kpiConfig, { openingCash: cash });

/** The cash book's remembered column choices (heading → what it holds). */
export const withCashColumns = (kpiConfig: unknown, map: Record<string, string>) => withPatch(kpiConfig, { cashColumns: map });
