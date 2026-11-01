import { PROFILE_KEY } from "./config-keys";

/**
 * Which accounting system the company keeps its books in (Phase 4a picker). It decides the Data steps' wording and
 * export instructions. "other" covers every system without a connector (QuickBooks, Xero, Daftra, Excel statements)
 * through the templates until Phase 6 adds connectors.
 */
export type AcctSystem = "odoo" | "other" | "cash";
export const ACCT_SYSTEMS: AcctSystem[] = ["odoo", "other", "cash"];
/** The "Not sure" question: what the business keeps today. */
export type KeepAnswer = "notebook" | "odoo" | "software" | "accountant";

const profileOf = (k: unknown) => ((k ?? {}) as Record<string, Record<string, unknown> | undefined>)[PROFILE_KEY] ?? {};

/** The chosen system; an Odoo-connected or cash-book company already says which. Null until chosen. */
export function systemOf(kpiConfig: unknown, source: string | null | undefined): AcctSystem | null {
  const p = profileOf(kpiConfig);
  if (p.mode === "simple") return "cash";
  // A cash-book answer only counts while the company is on the cash book; back on the full system the picker asks again.
  if (p.system === "odoo" || p.system === "other") return p.system;
  if (source === "odoo") return "odoo";
  return null;
}

export function withSystem(kpiConfig: unknown, system: AcctSystem): Record<string, unknown> {
  const cfg = { ...((kpiConfig ?? {}) as Record<string, unknown>) };
  cfg[PROFILE_KEY] = { ...((cfg[PROFILE_KEY] ?? {}) as Record<string, unknown>), system };
  return cfg;
}

export function suggestSystem(keep: KeepAnswer): AcctSystem {
  return keep === "notebook" ? "cash" : keep === "odoo" ? "odoo" : "other";
}

export interface SystemFlow { mode: "full" | "simple"; source: "upload" | "odoo"; exportHelp: "odoo" | "templates" | "none" }

/** What a choice sets up: the cash book app, or the full system with Odoo's or the templates' instructions. */
export function systemFlow(system: AcctSystem, opts: { live?: boolean } = {}): SystemFlow {
  if (system === "cash") return { mode: "simple", source: "upload", exportHelp: "none" };
  if (system === "odoo") return { mode: "full", source: opts.live ? "odoo" : "upload", exportHelp: "odoo" };
  return { mode: "full", source: "upload", exportHelp: "templates" };
}
