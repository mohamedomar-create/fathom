import {
  CalendarRange, ChartNoAxesCombined, ClipboardCheck, FileSpreadsheet, Gauge, Landmark, LayoutDashboard, Receipt, Scale, ShoppingBag, Sprout, Telescope, TrendingUp, Truck, Users, Package, Waves, ListTree, Boxes, ArrowLeftRight, ShieldCheck, HandCoins, Hospital,
  type LucideIcon,
} from "lucide-react";

export type NavGroupKey = "overview" | "performance" | "cash" | "plan";
export interface NavItem { href: string; label: string; icon: LucideIcon; title: string; /** Financials only: the heading this page sits under. */ group?: NavGroupKey }

export type SectorKey = "financials" | "sales" | "expenses" | "inventory" | "payments" | "banking";
export interface Sector { key: SectorKey; label: string; items: NavItem[] }

/** The app's sectors: each is a tab in the top bar, and its pages fill the side rail. */
export const SECTORS: Sector[] = [
  {
    key: "financials", label: "Financials", items: [
      { href: "summary", label: "Summary", title: "Executive Summary", icon: LayoutDashboard, group: "overview" },
      { href: "analysis/kpis", label: "KPIs", title: "KPIs", icon: ClipboardCheck, group: "overview" },
      { href: "analysis/explorer", label: "KPI Explorer", title: "KPI Explorer", icon: Gauge, group: "overview" },
      { href: "analysis/profitability", label: "Profitability", title: "Profitability", icon: ChartNoAxesCombined, group: "performance" },
      { href: "analysis/growth", label: "Growth", title: "Growth", icon: Sprout, group: "performance" },
      { href: "analysis/trend", label: "Trend", title: "Trend", icon: TrendingUp, group: "performance" },
      { href: "analysis/real-profit", label: "Real Profit", title: "Real Profit", icon: Scale, group: "performance" },
      { href: "analysis/cashflow", label: "Cash Flow", title: "Cash Flow", icon: Waves, group: "cash" },
      { href: "analysis/financials", label: "Financials", title: "Financials", icon: FileSpreadsheet, group: "cash" },
      { href: "analysis/forecast", label: "Forecast", title: "Forecast", icon: CalendarRange, group: "plan" },
      { href: "analysis/goalseek", label: "Goalseek", title: "Goalseek", icon: Telescope, group: "plan" },
    ],
  },
  {
    key: "sales", label: "Sales", items: [
      { href: "sales", label: "Overview", title: "Sales Overview", icon: ShoppingBag },
      { href: "sales/products", label: "Products", title: "Products and Categories", icon: Package },
      { href: "sales/customers", label: "Customers", title: "Customers", icon: Users },
      { href: "sales/trend", label: "Trend", title: "Sales Trend", icon: TrendingUp },
      { href: "sales/end-users", label: "End users", title: "End Users (agency sales)", icon: Hospital },
    ],
  },
  {
    key: "expenses", label: "Expenses", items: [
      { href: "expenses", label: "Overview", title: "Expenses Overview", icon: Receipt },
      { href: "expenses/accounts", label: "Accounts", title: "Expenses by Account", icon: ListTree },
      { href: "expenses/suppliers", label: "Suppliers", title: "Suppliers", icon: Truck },
      { href: "expenses/trend", label: "Trend", title: "Expenses Trend", icon: TrendingUp },
    ],
  },
  {
    key: "inventory", label: "Inventory", items: [
      { href: "inventory", label: "Overview", title: "Inventory Overview", icon: Boxes },
      { href: "inventory/products", label: "Products", title: "Stock by Product", icon: Package },
      { href: "inventory/movements", label: "Movements", title: "Stock Movements", icon: ArrowLeftRight },
      { href: "inventory/valuation", label: "Valuation", title: "Valuation and Checks", icon: ShieldCheck },
    ],
  },
  {
    key: "payments", label: "Payments", items: [
      { href: "payments", label: "Overview", title: "Payments Overview", icon: HandCoins },
      { href: "payments/receivables", label: "Receivables", title: "Receivables", icon: Users },
      { href: "payments/payables", label: "Payables", title: "Payables", icon: Truck },
      { href: "payments/flows", label: "Payments", title: "Payments In and Out", icon: ArrowLeftRight },
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
  const first = r.split("/")[0];
  const key: SectorKey = first === "sales" || first === "expenses" || first === "inventory" || first === "payments" || first === "banking" ? first : "financials";
  return SECTORS.find((s) => s.key === key)!;
}

export interface NavGroup { key: NavGroupKey | null; items: NavItem[] }

/** A sector's pages in their groups, in order: Financials has four headed groups, the others one group with no heading. */
export function navGroups(sector: Sector): NavGroup[] {
  const out: NavGroup[] = [];
  for (const it of sector.items) {
    const k = it.group ?? null;
    const last = out[out.length - 1];
    if (last && last.key === k) last.items.push(it);
    else out.push({ key: k, items: [it] });
  }
  return out;
}

export type BottomTab = "home" | "sales" | "expenses" | "pages" | "more";

/** Which phone bottom-bar tab a page lights, from its path relative to the company. */
export function bottomTab(rel: string): BottomTab {
  const first = rel.replace(/^\/+/, "").split("/")[0];
  if (first === "data" || first === "settings" || first === "reports") return "more";
  const s = sectorOf(rel).key;
  if (s === "financials") return "home";
  if (s === "sales" || s === "expenses") return s;
  return "pages";
}
