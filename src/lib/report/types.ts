import type { Assumptions, CompanySettings, ForecastDrivers, MonthData, PeriodSel, SalesData } from "@/lib/engine";
import type { AccountLine, AlertSetting } from "@/lib/company/types";

export const REPORT_SECTIONS = [
  { key: "cover", label: "Cover page" },
  { key: "summary", label: "Executive Summary" },
  { key: "kpis", label: "KPIs" },
  { key: "explorer", label: "KPI Explorer" },
  { key: "profitability", label: "Profitability" },
  { key: "cashflow", label: "Cash Flow" },
  { key: "pl", label: "Profit & Loss" },
  { key: "bs", label: "Balance Sheet" },
  { key: "cf", label: "Cash Flow Statement" },
  { key: "trend", label: "Trend" },
  { key: "growth", label: "Growth" },
  { key: "goalseek", label: "Goalseek" },
  { key: "forecast", label: "Forecast" },
  { key: "sales", label: "Sales" },
  { key: "bank", label: "Bank Readiness" },
  { key: "bank_outlook", label: "Bank: trend & stress test" },
  { key: "realprofit", label: "Real Profit" },
  { key: "basis", label: "Basis of Preparation" },
] as const;
export type SectionKey = (typeof REPORT_SECTIONS)[number]["key"];
export interface ReportSection { key: SectionKey; enabled: boolean }
/** Off unless chosen: the cash-flow statement, and the bank and real-profit pages (meant for a bank or owner pack). */
const OFF_BY_DEFAULT = new Set<string>(["cf", "bank", "bank_outlook", "realprofit"]);
export const DEFAULT_SECTIONS: ReportSection[] = REPORT_SECTIONS.map((s) => ({ key: s.key, enabled: !OFF_BY_DEFAULT.has(s.key) }));

/** Which commentary key each section shows. */
export const SECTION_COMMENT: Partial<Record<SectionKey, string>> = {
  summary: "summary", kpis: "kpis", profitability: "profitability", cashflow: "cashflow", pl: "pl", bs: "bs", trend: "trend", growth: "growth", goalseek: "goalseek", bank: "bank", realprofit: "realprofit",
};

export interface ReportOrg { name: string; logoUrl: string | null; brandColour: string | null; disclaimer: string; footer: string | null }

export interface ReportInput {
  title: string;
  companyName: string;
  months: MonthData[];
  accounts: AccountLine[];
  settings: CompanySettings;
  alerts: Record<string, AlertSetting>;
  sel: PeriodSel;
  sections: ReportSection[];
  commentary: Record<string, string>;
  org: ReportOrg;
  notes: string[];
  preparedOn: string;
  /** Known data issues an editor accepted at import, with their reason (disclosed in Basis of Preparation). */
  accepted?: AcceptedIssue[];
  /** Inflation, exchange rates and loan terms for the bank and real-profit pages. */
  assumptions?: Assumptions;
  /** Saved forecast drivers. */
  forecast?: ForecastDrivers;
  /** Sales by customer and product per month, for the Sales page (left out when there are none). */
  sales?: SalesData;
}

export interface AcceptedIssue { title: string; period?: string; reason: string }

export function normaliseSections(raw: unknown): ReportSection[] {
  const arr = Array.isArray(raw) ? (raw as ReportSection[]) : [];
  const known = new Set(REPORT_SECTIONS.map((s) => s.key));
  const out = arr.filter((s) => s && known.has(s.key)).map((s) => ({ key: s.key, enabled: Boolean(s.enabled) }));
  // A section added since the report was saved goes in its usual place, after the section that comes before it.
  DEFAULT_SECTIONS.forEach((d, i) => {
    if (out.some((s) => s.key === d.key)) return;
    const before = i > 0 ? out.findIndex((s) => s.key === DEFAULT_SECTIONS[i - 1].key) : -1;
    out.splice(before + 1, 0, d);
  });
  return out;
}
