"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as D from "@radix-ui/react-dialog";
import { Database, FileDown, LayoutDashboard, LayoutList, Menu, Receipt, Settings, ShoppingBag, X } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { useDict } from "@/lib/i18n/context";
import { cn } from "@/lib/cn";
import { SECTORS, bottomTab, navGroups, sectorOf, type BottomTab } from "./nav";

/** A sheet that slides up from the bottom of a phone screen. */
function Sheet({ trigger, title, children }: { trigger: React.ReactNode; title: string; children: React.ReactNode }) {
  const d = useDict();
  return (
    <D.Root>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <D.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-auto rounded-t-xl bg-white px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-2xl outline-none" data-testid="bottom-sheet">
          <div className="mb-2 flex items-center justify-between">
            <D.Title className="text-sm font-semibold">{title}</D.Title>
            <D.Description className="sr-only">{title}</D.Description>
            <D.Close className="rounded p-2 text-mute hover:bg-band" aria-label={d.dialog.close}><X className="h-5 w-5" /></D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

const rowCls = "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-band";

/** The phone bottom bar: Home, Sales, Expenses, the pages of this section, and everything else. On every company page. */
export function BottomBar() {
  const c = useCompany();
  const d = useDict();
  const pathname = usePathname();
  const qs = useSearchParams().toString();
  const q = qs ? `?${qs}` : "";
  const rel = pathname.slice(c.basePath.length);
  const on = bottomTab(rel);
  const sector = sectorOf(rel);
  const inSector = on !== "more";
  const href = (h: string) => `${c.basePath}/${h}`;
  const tabCls = (k: BottomTab) => cn("flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]", on === k ? "text-brand-d font-semibold" : "text-[#555]");
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden no-print" aria-label={d.shell.sections} data-testid="bottom-bar">
      <Link prefetch={false} href={href("summary") + q} className={tabCls("home")} aria-current={on === "home" ? "page" : undefined} data-testid="sector-financials">
        <LayoutDashboard className="h-5 w-5" strokeWidth={1.7} />{d.bottom.home}
      </Link>
      <Link prefetch={false} href={href("sales") + q} className={tabCls("sales")} aria-current={on === "sales" ? "page" : undefined} data-testid="sector-sales">
        <ShoppingBag className="h-5 w-5" strokeWidth={1.7} />{d.sectors.sales}
      </Link>
      <Link prefetch={false} href={href("expenses") + q} className={tabCls("expenses")} aria-current={on === "expenses" ? "page" : undefined} data-testid="sector-expenses">
        <Receipt className="h-5 w-5" strokeWidth={1.7} />{d.sectors.expenses}
      </Link>
      <Sheet title={inSector ? `${d.sectors[sector.key]}: ${d.bottom.sectionPages}` : d.bottom.sectionPages}
        trigger={<button type="button" className={tabCls("pages")} disabled={!inSector} data-testid="bottom-pages"><LayoutList className="h-5 w-5" strokeWidth={1.7} />{d.bottom.pages}</button>}>
        {navGroups(sector).map((g) => (
          <div key={g.key ?? "all"} className="mb-2">
            {g.key && <div className="label px-3 pb-1 pt-2">{d.navGroups[g.key]}</div>}
            {g.items.map((n) => {
              const active = pathname === href(n.href);
              return (
                <D.Close asChild key={n.href}>
                  <Link prefetch={false} href={href(n.href) + q} aria-current={active ? "page" : undefined} className={cn(rowCls, active && "bg-brand-bg text-brand-d")} data-testid={`sheet-${n.href.split("/").pop()}`}>
                    <n.icon className="h-4 w-4" />{d.nav[n.href]?.[1] ?? n.title}
                  </Link>
                </D.Close>
              );
            })}
          </div>
        ))}
      </Sheet>
      <Sheet title={d.bottom.everything}
        trigger={<button type="button" className={tabCls("more")} data-testid="bottom-more"><Menu className="h-5 w-5" strokeWidth={1.7} />{d.bottom.more}</button>}>
        {SECTORS.map((s) => {
          const Icon = s.items[0].icon;
          return (
            <D.Close asChild key={s.key}>
              <Link prefetch={false} href={href(s.items[0].href) + q} className={rowCls} data-testid={`more-sector-${s.key}`}>
                <Icon className="h-4 w-4" />{d.sectors[s.key]}
              </Link>
            </D.Close>
          );
        })}
        <div className="my-2 border-t border-line" />
        <D.Close asChild><Link prefetch={false} href={href("reports")} className={rowCls} data-testid="more-reports"><FileDown className="h-4 w-4" />{d.shell.reports}</Link></D.Close>
        <D.Close asChild><Link prefetch={false} href={href("data")} className={rowCls} data-testid="more-data"><Database className="h-4 w-4" />{d.shell.data}</Link></D.Close>
        <D.Close asChild><Link prefetch={false} href={href("settings/profile")} className={rowCls} data-testid="more-settings"><Settings className="h-4 w-4" />{d.shell.settings}</Link></D.Close>
      </Sheet>
    </nav>
  );
}
