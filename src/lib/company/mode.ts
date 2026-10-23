import { PROFILE_KEY } from "./config-keys";

/**
 * How a company uses the app. "full": every module, for companies with an ERP's books. "simple": a Sales sheet and an
 * Expenses sheet only. Both use the same data and the same figures; switching only changes what is shown, so nothing
 * is ever lost. A company with no mode set is Full.
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

/** The cash the company held on a day, the starting point for its cash balance and runway in Simple mode. */
export function openingCashOf(kpiConfig: unknown): OpeningCash | null {
  const v = profileOf(kpiConfig).openingCash as Partial<OpeningCash> | undefined;
  return v && typeof v.amount === "number" && Number.isFinite(v.amount) && typeof v.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.asOf) ? { amount: v.amount, asOf: v.asOf } : null;
}

export const withOpeningCash = (kpiConfig: unknown, cash: OpeningCash | null) => withPatch(kpiConfig, { openingCash: cash });
