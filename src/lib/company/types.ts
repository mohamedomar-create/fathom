import type { ClassKey, CompanySettings, MonthData } from "@/lib/engine";

/** One general-ledger account with its monthly amounts in natural sign
 *  (P&L: movement for the month, positive for revenue and for costs; BS: closing balance, positive as presented). */
export interface AccountLine {
  id: string;
  code: string;
  name: string;
  cls: ClassKey;
  amounts: Record<string, number>;
}

export interface AlertSetting { active: boolean; threshold: number | null }

export interface CompanyBundle {
  id: string;
  name: string;
  basePath: string;
  source: "demo" | "upload" | "odoo";
  months: MonthData[];
  settings: CompanySettings;
  alerts: Record<string, AlertSetting>;
  accounts: AccountLine[];
  commentary: Record<string, string>;
  readOnly: boolean;
  lastUpdated?: string | null;
  orgName?: string;
  notes?: string[];
  companies?: { id: string; name: string }[];
  aiEnabled?: boolean;
  /** Known data issues accepted at import (shown in reports). */
  accepted?: { title: string; period?: string; reason: string }[];
  /** Blocking checks failing in the current data that nobody accepted. */
  health?: { failing: number };
  /** The latest month is a part month whose figures stop on this day ("2026-10-10"). */
  asOf?: string;
}
