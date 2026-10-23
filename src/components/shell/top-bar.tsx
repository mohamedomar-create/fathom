"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { useDict } from "@/lib/i18n/context";
import { LangSwitch } from "./lang-switch";
import { LogoMark } from "./logo";
import { sectorOf, sectorsFor } from "./nav";
import { cn } from "@/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function TopBar({ right }: { right?: React.ReactNode }) {
  const c = useCompany();
  const d = useDict();
  const publicDemo = c.basePath === "/demo";
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  const q = qs ? `?${qs}` : "";
  const rel = pathname.slice(c.basePath.length);
  const elsewhere = rel.startsWith("/reports") || rel.startsWith("/settings") || rel.startsWith("/data");
  const here = sectorOf(rel, c.mode).key;
  const tabs = [
    ...sectorsFor(c.mode).map((s) => ({ key: s.key as string, href: `${c.basePath}/${s.items[0].href}`, label: d.sectors[s.key], keepQuery: true, active: !elsewhere && here === s.key })),
    { key: "reports", href: `${c.basePath}/reports`, label: d.shell.reports, keepQuery: false, active: rel.startsWith("/reports") },
    { key: "data", href: `${c.basePath}/data`, label: d.shell.data, keepQuery: false, active: rel.startsWith("/data") },
    { key: "settings", href: `${c.basePath}/settings/profile`, label: d.shell.settings, keepQuery: false, active: rel.startsWith("/settings") },
  ];
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 bg-bar px-3 text-[13px] text-[#ddd] no-print">
      <Link prefetch={false} href={publicDemo ? "/" : "/companies"} className="rounded p-1.5 hover:bg-bar-2" aria-label={d.shell.backToCompanies}>
        <ArrowLeft className="flip-rtl h-4 w-4" />
      </Link>
      <Popover>
        <PopoverTrigger className="flex max-w-[40vw] items-center gap-1 truncate rounded px-2 py-1 font-semibold text-white hover:bg-bar-2" data-testid="company-switcher">
          <span className="truncate">{c.name}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <div className="label px-2 pb-1">{d.shell.companies}</div>
          {(c.companies ?? [{ id: c.id, name: c.name }]).map((x) => (
            <Link prefetch={false} key={x.id} href={publicDemo ? "/demo/summary" : `/company/${x.id}/summary`} className={cn("block rounded px-2 py-1.5 text-sm hover:bg-band", x.id === c.id && "font-semibold")}>
              {x.name}
            </Link>
          ))}
          {!publicDemo && <Link prefetch={false} href="/companies" className="mt-1 block border-t border-line px-2 pt-2 text-sm text-brand-d">{d.shell.allCompanies}</Link>}
        </PopoverContent>
      </Popover>
      <nav className="ms-1 hidden items-center gap-1 sm:flex">
        {tabs.map((t) => (
          // Not preloaded: a section's layout loads all its data, so a preload downloads the whole section (megabytes)
          // while the person works on another page.
          <Link prefetch={false} key={t.key} href={t.href + (t.keepQuery ? q : "")} aria-current={t.active ? "page" : undefined} data-testid={`tab-${t.key}`} className={cn("rounded px-3 py-1 hover:text-white", t.active ? "bg-bar-2 text-white" : "")}>
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="ms-auto flex items-center gap-3">
        {publicDemo && <span className="rounded bg-amber/90 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-bar">{d.shell.demoCompany}</span>}
        {right}
        <LangSwitch compact className="text-[#ccc] hover:bg-bar-2 hover:text-white" />
        <LogoMark size={20} className="hidden md:block" />
      </div>
    </header>
  );
}
