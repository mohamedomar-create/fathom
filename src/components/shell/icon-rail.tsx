"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FileDown } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { cn } from "@/lib/cn";
import { Tip } from "@/components/ui/tooltip";
import { useDict } from "@/lib/i18n/context";
import { navGroups, sectorOf } from "./nav";

export function IconRail() {
  const c = useCompany();
  const d = useDict();
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  const q = qs ? `?${qs}` : "";
  if (pathname.includes("/settings") || pathname.includes("/reports") || /\/data(\/|$)/.test(pathname)) return null;
  const sector = sectorOf(pathname.slice(c.basePath.length));
  return (
    <>
      {/* desktop rail */}
      <aside className="sticky top-12 hidden h-[calc(100vh-48px)] w-[66px] shrink-0 flex-col items-center gap-1 border-e border-line bg-white py-3 md:flex no-print">
        {navGroups(sector).flatMap((g, gi) => g.items.map((n, ii) => {
          const href = `${c.basePath}/${n.href}`;
          const active = pathname === href;
          return (
            <div key={n.href} className={cn(gi > 0 && ii === 0 && "mt-1 border-t border-line pt-2")} data-group={ii === 0 && g.key ? g.key : undefined}>
            <Tip label={d.nav[n.href]?.[1] ?? n.title}>
              <Link prefetch={false} href={href + q} aria-label={d.nav[n.href]?.[1] ?? n.title} data-testid={`nav-${n.href.split("/").pop()}`}
                className={cn("flex h-11 w-11 items-center justify-center rounded-md text-[#555] transition hover:bg-band hover:text-ink", active && "bg-brand-bg text-brand-d hover:bg-brand-bg")}>
                <n.icon className="h-5 w-5" strokeWidth={1.7} />
              </Link>
            </Tip>
            </div>
          );
        }))}
        <div className="mt-auto">
          <Tip label={d.shell.reportsTip}>
            <Link prefetch={false} href={`${c.basePath}/reports`} className="flex h-11 w-11 items-center justify-center rounded-md text-[#555] hover:bg-band" aria-label={d.shell.reportsAria}>
              <FileDown className="h-5 w-5" strokeWidth={1.7} />
            </Link>
          </Tip>
        </div>
      </aside>
    </>
  );
}
