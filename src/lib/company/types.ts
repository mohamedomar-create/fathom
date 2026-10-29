import type { LocationTypes } from "@/lib/ingest/inventory";
import type { Assumptions, ForecastDrivers, ClassKey, CompanySettings, MonthData } from "@/lib/engine";

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
  /** The signed-in person's role in the company's organisation (absent in the demo). */
  role?: string;
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
  /** The unit the books were stated in (1,000 for a file "in thousands"): the checks allow one unit of rounding. */
  unit?: number;
  /** Economic assumptions (inflation, exchange rates, borrowing) for the bank and real-profit views. */
  assumptions?: Assumptions;
  /** Inventory settings: the location rented items go to (null: found by its name). */
  inventorySettings?: { rentalLocation: string | null; locationTypes?: LocationTypes };
  /** Where the company is ("Africa/Cairo"): Odoo's UTC date-times are moved to its days. Null: not moved. */
  timeZone?: string | null;
  /** The company said its books start from zero (no opening balance due). */
  booksFromZero?: boolean;
  /** Forecast drivers the company has saved. */
  forecast?: ForecastDrivers;
}
