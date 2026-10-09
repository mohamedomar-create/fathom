"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function TopBar({ right }: { right?: React.ReactNode }) {
  const c = useCompany();
  const publicDemo = c.basePath === "/demo";
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  const q = qs ? `?${qs}` : "";
  const tabs = [
    { href: `${c.basePath}/summary`, label: "Analysis", match: (p: string) => p.includes("/analysis") || p.endsWith("/summary") },
    { href: `${c.basePath}/reports`, label: "Reports", match: (p: string) => p.includes("/reports") },
    { href: `${c.basePath}/settings/source-data`, label: "Settings", match: (p: string) => p.includes("/settings") },
  ];
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 bg-bar px-3 text-[13px] text-[#ddd] no-print">
      <Link prefetch={false} href={publicDemo ? "/" : "/companies"} className="rounded p-1.5 hover:bg-bar-2" aria-label="Back to companies">
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <Popover>
        <PopoverTrigger className="flex max-w-[40vw] items-center gap-1 truncate rounded px-2 py-1 font-semibold text-white hover:bg-bar-2" data-testid="company-switcher">
          <span className="truncate">{c.name}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </PopoverTrigger>
        <PopoverContent className="w-64">
          <div className="label px-2 pb-1">Companies</div>
          {(c.companies ?? [{ id: c.id, name: c.name }]).map((x) => (
            <Link prefetch={false} key={x.id} href={publicDemo ? "/demo/summary" : `/company/${x.id}/summary`} className={cn("block rounded px-2 py-1.5 text-sm hover:bg-band", x.id === c.id && "font-semibold")}>
              {x.name}
            </Link>
          ))}
          {!publicDemo && <Link prefetch={false} href="/companies" className="mt-1 block border-t border-line px-2 pt-2 text-sm text-green-d">All companies →</Link>}
        </PopoverContent>
      </Popover>
      <nav className="ml-1 hidden items-center gap-1 sm:flex">
        {tabs.map((t) => (
          <Link prefetch={false} key={t.label} href={t.href + (t.label === "Analysis" ? q : "")} className={cn("rounded px-3 py-1 hover:text-white", t.match(pathname) ? "bg-bar-2 text-white" : "")}>
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        {publicDemo && <span className="rounded bg-amber/90 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-bar">Demo company</span>}
        {right}
        <span className="hidden text-[12px] text-[#999] md:inline">{APP_NAME}</span>
      </div>
    </header>
  );
}
