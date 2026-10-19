"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FileDown } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { cn } from "@/lib/cn";
import { Tip } from "@/components/ui/tooltip";
import { useDict } from "@/lib/i18n/context";
import { SECTORS, sectorOf } from "./nav";

export function IconRail() {
  const c = useCompany();
  const d = useDict();
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  const q = qs ? `?${qs}` : "";
  if (pathname.includes("/settings") || pathname.includes("/reports") || /\/data(\/|$)/.test(pathname)) return null;
  const sector = sectorOf(pathname.slice(c.basePath.length));
  const items = sector.items;
  return (
    <>
      {/* desktop rail */}
      <aside className="sticky top-12 hidden h-[calc(100vh-48px)] w-[66px] shrink-0 flex-col items-center gap-1 border-e border-line bg-white py-3 md:flex no-print">
        {items.map((n) => {
          const href = `${c.basePath}/${n.href}`;
          const active = pathname === href;
          return (
            <div key={n.href} className={cn(n.group && "mt-1 border-t border-line pt-2")}>
            <Tip label={d.nav[n.href]?.[1] ?? n.title}>
              <Link href={href + q} aria-label={d.nav[n.href]?.[1] ?? n.title} data-testid={`nav-${n.href.split("/").pop()}`}
                className={cn("flex h-11 w-11 items-center justify-center rounded-md text-[#555] transition hover:bg-band hover:text-ink", active && "bg-brand-bg text-brand-d hover:bg-brand-bg")}>
                <n.icon className="h-5 w-5" strokeWidth={1.7} />
              </Link>
            </Tip>
            </div>
          );
        })}
        <div className="mt-auto">
          <Tip label={d.shell.reportsTip}>
            <Link href={`${c.basePath}/reports`} className="flex h-11 w-11 items-center justify-center rounded-md text-[#555] hover:bg-band" aria-label={d.shell.reportsAria}>
              <FileDown className="h-5 w-5" strokeWidth={1.7} />
            </Link>
          </Tip>
        </div>
      </aside>
      {/* mobile nav */}
      <nav className="sticky top-12 z-20 flex gap-1 overflow-x-auto border-b border-line bg-white px-2 py-1.5 md:hidden no-print" aria-label={d.shell.sections}>
        {SECTORS.filter((s) => s.key !== sector.key).map((s) => (
          <Link key={s.key} href={`${c.basePath}/${s.items[0].href}${q}`} data-testid={`sector-${s.key}`} className="flex shrink-0 items-center rounded-full border border-line px-3 py-1 text-xs text-[#555]">{d.sectors[s.key]}</Link>
        ))}
        <span className="mx-1 w-px shrink-0 bg-line" aria-hidden="true" />
        {items.map((n) => {
          const href = `${c.basePath}/${n.href}`;
          const active = pathname === href;
          return (
            <Link key={n.href} href={href + q} className={cn("flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs", active ? "bg-brand-bg text-brand-d" : "text-[#555]")}>
              <n.icon className="h-3.5 w-3.5" />{d.nav[n.href]?.[0] ?? n.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
