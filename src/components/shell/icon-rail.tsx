"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FileDown } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { cn } from "@/lib/cn";
import { Tip } from "@/components/ui/tooltip";
import { ANALYSIS_NAV } from "./nav";

export function IconRail() {
  const c = useCompany();
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  const q = qs ? `?${qs}` : "";
  if (pathname.includes("/settings") || pathname.includes("/reports")) return null;
  return (
    <>
      {/* desktop rail */}
      <aside className="sticky top-12 hidden h-[calc(100vh-48px)] w-[66px] shrink-0 flex-col items-center gap-1 border-r border-line bg-white py-3 md:flex no-print">
        {ANALYSIS_NAV.map((n) => {
          const href = `${c.basePath}/${n.href}`;
          const active = pathname === href;
          return (
            <div key={n.href} className={cn(n.group && "mt-1 border-t border-line pt-2")}>
            <Tip label={n.title}>
              <Link prefetch={false} href={href + q} aria-label={n.title} data-testid={`nav-${n.href.split("/").pop()}`}
                className={cn("flex h-11 w-11 items-center justify-center rounded-md text-[#555] transition hover:bg-band hover:text-ink", active && "bg-brand-bg text-brand-d hover:bg-brand-bg")}>
                <n.icon className="h-5 w-5" strokeWidth={1.7} />
              </Link>
            </Tip>
            </div>
          );
        })}
        <div className="mt-auto">
          <Tip label="Create a report / download PDF">
            <Link prefetch={false} href={`${c.basePath}/reports`} className="flex h-11 w-11 items-center justify-center rounded-md text-[#555] hover:bg-band" aria-label="Reports and PDF">
              <FileDown className="h-5 w-5" strokeWidth={1.7} />
            </Link>
          </Tip>
        </div>
      </aside>
      {/* mobile nav */}
      <nav className="sticky top-12 z-20 flex gap-1 overflow-x-auto border-b border-line bg-white px-2 py-1.5 md:hidden no-print">
        {ANALYSIS_NAV.map((n) => {
          const href = `${c.basePath}/${n.href}`;
          const active = pathname === href;
          return (
            <Link prefetch={false} key={n.href} href={href + q} className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs", active ? "bg-brand-bg text-brand-d" : "text-[#555]")}>
              <n.icon className="h-3.5 w-3.5" />{n.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
