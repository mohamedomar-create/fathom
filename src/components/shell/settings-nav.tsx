"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCompany } from "@/lib/company/context";
import { cn } from "@/lib/cn";
import { useDict } from "@/lib/i18n/context";

const ITEMS = [
  { n: 1, href: "data-setup", label: "Data Setup", sub: "Step by step, templates, readiness" },
  { n: 2, href: "source-data", label: "Source Data", sub: "Upload or connect Odoo" },
  { n: 3, href: "data-health", label: "Data Health", sub: "Months, checks, history & undo" },
  { n: 4, href: "profile", label: "Company Profile", sub: "Currency, year, tax, AI context" },
  { n: 5, href: "chart-of-accounts", label: "Chart of Accounts", sub: "Mapping & behaviour" },
  { n: 6, href: "kpis", label: "KPIs", sub: "Choose & rank KPIs" },
  { n: 7, href: "targets", label: "Targets", sub: "Monthly targets" },
  { n: 8, href: "alerts", label: "Alerts", sub: "Thresholds" },
];

export function SettingsNav() {
  const c = useCompany();
  const d = useDict();
  const path = usePathname();
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto md:mb-0 md:w-60 md:shrink-0 md:flex-col md:overflow-visible">
      <div className="mb-3 hidden rounded-md bg-band p-3 md:block">
        <div className="truncate font-medium">{c.name}</div>
        <div className="text-xs text-mute">{c.months.length ? d.settingsNav.monthsLoaded(c.months.length) : d.settingsNav.noData}</div>
      </div>
      {ITEMS.map((i) => {
        const href = `${c.basePath}/settings/${i.href}`;
        const on = path === href;
        return (
          <Link prefetch={false} key={i.href} href={href} className={cn("flex shrink-0 items-start gap-3 rounded-md px-3 py-2 hover:bg-band", on && "bg-brand-bg/70")}>
            <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", on ? "bg-brand-d text-white" : "bg-[#e8e8e4] text-mute")}>{i.n}</span>
            <span><span className="block text-sm font-medium">{d.settingsNav.items[i.href]?.[0] ?? i.label}</span><span className="hidden text-xs text-mute md:block">{d.settingsNav.items[i.href]?.[1] ?? i.sub}</span></span>
          </Link>
        );
      })}
    </nav>
  );
}
