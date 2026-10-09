import type { CompanySettings, MonthData, PeriodSel } from "@/lib/engine";
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
  { key: "basis", label: "Basis of Preparation" },
] as const;
export type SectionKey = (typeof REPORT_SECTIONS)[number]["key"];
export interface ReportSection { key: SectionKey; enabled: boolean }
export const DEFAULT_SECTIONS: ReportSection[] = REPORT_SECTIONS.map((s) => ({ key: s.key, enabled: s.key !== "cf" }));

/** Which commentary key each section shows. */
export const SECTION_COMMENT: Partial<Record<SectionKey, string>> = {
  summary: "summary", kpis: "kpis", profitability: "profitability", cashflow: "cashflow", pl: "pl", bs: "bs", trend: "trend", growth: "growth", goalseek: "goalseek",
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
}

export function normaliseSections(raw: unknown): ReportSection[] {
  const arr = Array.isArray(raw) ? (raw as ReportSection[]) : [];
  const known = new Set(REPORT_SECTIONS.map((s) => s.key));
  const out = arr.filter((s) => s && known.has(s.key)).map((s) => ({ key: s.key, enabled: Boolean(s.enabled) }));
  for (const d of DEFAULT_SECTIONS) if (!out.some((s) => s.key === d.key)) out.push(d);
  return out;
}
