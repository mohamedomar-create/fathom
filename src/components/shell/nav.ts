import {
  ChartNoAxesCombined, ClipboardCheck, FileSpreadsheet, Gauge, Landmark, LayoutDashboard, Scale, Sprout, Telescope, TrendingUp, Waves,
  type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon; title: string; /** Starts the advisory group (a line above it in the rail). */ group?: boolean }

export const ANALYSIS_NAV: NavItem[] = [
  { href: "summary", label: "Summary", title: "Executive Summary", icon: LayoutDashboard },
  { href: "analysis/kpis", label: "KPIs", title: "KPIs", icon: ClipboardCheck },
  { href: "analysis/explorer", label: "KPI Explorer", title: "KPI Explorer", icon: Gauge },
  { href: "analysis/profitability", label: "Profitability", title: "Profitability", icon: ChartNoAxesCombined },
  { href: "analysis/cashflow", label: "Cash Flow", title: "Cash Flow", icon: Waves },
  { href: "analysis/growth", label: "Growth", title: "Growth", icon: Sprout },
  { href: "analysis/trend", label: "Trend", title: "Trend", icon: TrendingUp },
  { href: "analysis/goalseek", label: "Goalseek", title: "Goalseek", icon: Telescope },
  { href: "analysis/financials", label: "Financials", title: "Financials", icon: FileSpreadsheet },
  { href: "analysis/bank", label: "Bank Readiness", title: "Bank Readiness", icon: Landmark, group: true },
  { href: "analysis/real-profit", label: "Real Profit", title: "Real Profit", icon: Scale },
];
