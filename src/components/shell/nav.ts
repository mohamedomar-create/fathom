import {
  CalendarRange, ChartNoAxesCombined, ClipboardCheck, FileSpreadsheet, Gauge, Landmark, LayoutDashboard, Receipt, Scale, ShoppingBag, Sprout, Telescope, TrendingUp, Truck, Users, Package, Waves, ListTree, Boxes, ArrowLeftRight, ShieldCheck, HandCoins, Stethoscope, Hospital, Target, BriefcaseBusiness, Gem, Layers, SlidersHorizontal, ShoppingCart,
  type LucideIcon,
} from "lucide-react";
import { MODULE_SECTOR } from "@/lib/modules/sectors";
import { isOn, openExtras, type CompanyModule } from "@/lib/modules/company";
import { moduleByKey } from "@/lib/modules/registry";

export type NavGroupKey = "overview" | "performance" | "cash" | "plan";
export interface NavItem { href: string; label: string; icon: LucideIcon; title: string; /** Financials only: the heading this page sits under. */ group?: NavGroupKey }

export type BaseSectorKey = "financials" | "sales" | "expenses" | "inventory" | "payments" | "banking" | "planning" | "doctor" | "valuation";
/** A module the company opened (HR, CRM, one it built…) is a tab of its own: "mod_<module key>". */
export type SectorKey = BaseSectorKey | `mod_${string}`;
export interface Sector { key: SectorKey; label: string; items: NavItem[] }
const isBase = (k: string): k is BaseSectorKey => SECTORS.some((s) => s.key === k);
/** A sector's tab label: the dictionary's for the built-in areas, the module's own name for a module tab. */
export const sectorLabel = (s: Sector, names: Record<string, string>) => (s.key.startsWith("mod_") ? s.label : names[s.key] ?? s.label);

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
      { href: "modules/purchasing", label: "Purchasing", title: "Purchasing", icon: ShoppingCart },
    ],
  },
  {
    key: "inventory", label: "Inventory", items: [
      { href: "inventory", label: "Overview", title: "Inventory Overview", icon: Boxes },
      { href: "inventory/products", label: "Products", title: "Stock by Product", icon: Package },
      { href: "inventory/movements", label: "Movements", title: "Stock Movements", icon: ArrowLeftRight },
      { href: "inventory/valuation", label: "Stock valuation", title: "Stock valuation and checks", icon: ShieldCheck },
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
  {
    key: "planning", label: "Planning", items: [
      { href: "planning", label: "Business plan", title: "Business Plan", icon: BriefcaseBusiness },
      { href: "planning/budget", label: "Budget", title: "Budget", icon: Target },
    ],
  },
  {
    key: "doctor", label: "Doctor", items: [
      { href: "doctor", label: "System doctor", title: "AI System Doctor", icon: Stethoscope },
    ],
  },
  {
    key: "valuation", label: "Valuation", items: [
      { href: "valuation", label: "Valuation", title: "Valuation", icon: Gem },
      { href: "valuation/methods", label: "Methods", title: "Valuation methods", icon: Layers },
      { href: "valuation/assumptions", label: "Assumptions", title: "Valuation assumptions", icon: SlidersHorizontal },
    ],
  },
];

/** A module's own tab: its page (and, as it grows, its other pages). */
const moduleSector = (key: string, name: string, icon: LucideIcon = Layers): Sector => ({ key: `mod_${key}`, label: name, items: [{ href: `modules/${key}`, label: name, title: name, icon }] });
/** Sectors that read the books: hidden when the company turned Financials off. */
const BOOKS = new Set<string>(["financials", "banking", "planning", "doctor", "valuation"]);
const OWNER: Partial<Record<string, string>> = { sales: "sales", expenses: "expenses", inventory: "inventory", payments: "payments" };

/** The sectors this company shows, from the modules it has on: turned-off ones go, opened catalog and custom ones join. */
export function sectorsFor(rows: CompanyModule[], role: string, userId: string | null | undefined, lang: "en" | "ar" = "en"): Sector[] {
  const out: Sector[] = [];
  const purchasing = isOn("purchasing", rows);
  for (const s of SECTORS) {
    if (BOOKS.has(s.key) && !isOn("financials", rows)) continue;
    const owner = OWNER[s.key];
    if (owner && !isOn(owner, rows)) continue;
    out.push(s.key === "expenses" && !purchasing ? { ...s, items: s.items.filter((i) => i.href !== "modules/purchasing") } : s);
  }
  // Purchasing sits under Expenses; with Expenses off it is a tab of its own.
  if (purchasing && !isOn("expenses", rows)) out.push(moduleSector("purchasing", lang === "ar" ? "المشتريات" : "Purchasing", ShoppingCart));
  for (const r of openExtras(rows, role, userId)) {
    // A catalog module's name in the page's language; a custom one's from its definition, else the name it was saved under.
    const own = (r.spec as { name?: { en?: string; ar?: string } } | null)?.name;
    out.push(moduleSector(r.key, moduleByKey(r.key)?.name[lang] ?? own?.[lang] ?? r.name ?? r.key));
  }
  return out;
}

/** The sector a page belongs to, from its path relative to the company (e.g. "sales/products"). */
export function sectorOf(rel: string): Sector {
  const r = rel.replace(/^\/+/, "");
  const parts = r.split("/");
  // A module added by definition sits in its own sector ("modules/purchasing" is under Expenses).
  // A module page sits in the area it belongs to (Purchasing under Expenses), else in a tab of its own.
  if (parts[0] === "modules" && parts[1]) {
    const home = MODULE_SECTOR[parts[1]];
    if (home && isBase(home)) return SECTORS.find((s) => s.key === home)!;
    return moduleSector(parts[1], moduleByKey(parts[1])?.name.en ?? parts[1]);
  }
  const key: BaseSectorKey = isBase(parts[0]) ? parts[0] : "financials";
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
