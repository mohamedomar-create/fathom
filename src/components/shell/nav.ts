import {
  CalendarRange, ChartNoAxesCombined, ClipboardCheck, FileSpreadsheet, Gauge, Landmark, LayoutDashboard, Scale, ShoppingBag, Sprout, Telescope, TrendingUp, Users, Package, Waves,
  type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon; title: string; /** Starts a second group (a line above it in the rail). */ group?: boolean }

export type SectorKey = "financials" | "sales" | "banking";
export interface Sector { key: SectorKey; label: string; items: NavItem[] }

/** The app's sectors: each is a tab in the top bar, and its pages fill the side rail. */
export const SECTORS: Sector[] = [
  {
    key: "financials", label: "Financials", items: [
      { href: "summary", label: "Summary", title: "Executive Summary", icon: LayoutDashboard },
      { href: "analysis/kpis", label: "KPIs", title: "KPIs", icon: ClipboardCheck },
      { href: "analysis/explorer", label: "KPI Explorer", title: "KPI Explorer", icon: Gauge },
      { href: "analysis/profitability", label: "Profitability", title: "Profitability", icon: ChartNoAxesCombined },
      { href: "analysis/cashflow", label: "Cash Flow", title: "Cash Flow", icon: Waves },
      { href: "analysis/growth", label: "Growth", title: "Growth", icon: Sprout },
      { href: "analysis/trend", label: "Trend", title: "Trend", icon: TrendingUp },
      { href: "analysis/goalseek", label: "Goalseek", title: "Goalseek", icon: Telescope },
      { href: "analysis/forecast", label: "Forecast", title: "Forecast", icon: CalendarRange },
      { href: "analysis/financials", label: "Financials", title: "Financials", icon: FileSpreadsheet },
      { href: "analysis/real-profit", label: "Real Profit", title: "Real Profit", icon: Scale, group: true },
    ],
  },
  {
    key: "sales", label: "Sales", items: [
      { href: "sales", label: "Overview", title: "Sales Overview", icon: ShoppingBag },
      { href: "sales/products", label: "Products", title: "Products and Categories", icon: Package },
      { href: "sales/customers", label: "Customers", title: "Customers", icon: Users },
      { href: "sales/trend", label: "Trend", title: "Sales Trend", icon: TrendingUp },
    ],
  },
  {
    key: "banking", label: "Banking", items: [
      { href: "banking", label: "Bank Readiness", title: "Bank Readiness", icon: Landmark },
    ],
  },
];

/** The sector a page belongs to, from its path relative to the company (e.g. "sales/products"). */
export function sectorOf(rel: string): Sector {
  const r = rel.replace(/^\/+/, "");
  const key: SectorKey = r === "sales" || r.startsWith("sales/") ? "sales" : r === "banking" || r.startsWith("banking/") ? "banking" : "financials";
  return SECTORS.find((s) => s.key === key)!;
}
