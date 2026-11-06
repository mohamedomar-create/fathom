import type { LocationTypes } from "@/lib/ingest/inventory";
import type { Assumptions, ForecastDrivers, ClassKey, CompanySettings, MonthData, SubKey } from "@/lib/engine";

/** One general-ledger account with its monthly amounts in natural sign
 *  (P&L: movement for the month, positive for revenue and for costs; BS: closing balance, positive as presented). */
export interface AccountLine {
  id: string;
  code: string;
  name: string;
  cls: ClassKey;
  amounts: Record<string, number>;
  /** Its sub-class, if any (the company's map, else the name rules). */
  sub?: SubKey | null;
}

export interface AlertSetting { active: boolean; threshold: number | null }

export interface CompanyBundle {
  /** The modules the company opened or closed, and the ones it built (company_modules). */
  modules?: import("@/lib/modules/company").CompanyModule[];
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
  /** The signed-in person's role in the company's organisation (absent in the demo). */
  role?: string;
  /** The signed-in person (for modules shared with named people). */
  userId?: string;
  lastUpdated?: string | null;
  orgName?: string;
  notes?: string[];
  companies?: { id: string; name: string }[];
  aiEnabled?: boolean;
  /** Known data issues accepted at import (shown in reports). */
  accepted?: { title: string; period?: string; reason: string }[];
  /** Blocking checks failing in the current data that nobody accepted. */
  /** Where the current books come from (undefined: an older upload that didn't say). */
  booksBasis?: "ledger" | "odoo" | "statements" | "cash";
  /** failing: blocking checks not accepted; state comes from the one status model (unknown when the checks couldn't be read). */
  health?: { failing: number; warnings?: number; state?: "ok" | "failing" | "unknown" };
  /** The latest month is a part month whose figures stop on this day ("2026-10-10"). */
  asOf?: string;
  /** The books are closed up to and including this month (0043): nothing in it changes until it is reopened. */
  closedThrough?: string | null;
  /** The unit the books were stated in (1,000 for a file "in thousands"): the checks allow one unit of rounding. */
  unit?: number;
  /** Economic assumptions (inflation, exchange rates, borrowing) for the bank and real-profit views. */
  assumptions?: Assumptions;
  /** Inventory settings: the location rented items go to (null: found by its name). */
  inventorySettings?: { rentalLocation: string | null; locationTypes?: LocationTypes };
  /** Where the company is ("Africa/Cairo"): Odoo's UTC date-times are moved to its days. Null: not moved. */
  timeZone?: string | null;
  /** The approved budget's figures are the KPI targets where none is typed (Settings, Targets). */
  budgetTargets?: boolean;
  /** The approved budget of each financial year, loaded only when budgetTargets is on. */
  budgets?: { fy: string; name: string; lines: import("@/lib/engine/budget").BudgetLine[]; products: import("@/lib/engine/budget").BudgetProduct[] }[];
  /** The company said its books start from zero (no opening balance due). */
  booksFromZero?: boolean;
  /** Which accounting system the books come from (Phase 4a picker); null until chosen. */
  system?: import("./system").AcctSystem | null;
  /** Forecast drivers the company has saved. */
  forecast?: ForecastDrivers;
}
