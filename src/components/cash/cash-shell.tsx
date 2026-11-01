"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as D from "@radix-ui/react-dialog";
import { ArrowLeft, LayoutDashboard, ListOrdered, Menu, Plus, X } from "lucide-react";
import { useDict } from "@/lib/i18n/context";
import { LangSwitch } from "@/components/shell/lang-switch";
import { TipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

const TABS = ["", "in", "out", "cash", "entries", "upload", "settings"] as const;

/** The cash book's own frame: the business name, its seven pages, nothing from the full system. */
export function CashShell({ id, name, right, children, base: baseIn, demo = false, readOnly = demo }: { id: string; name: string; right?: React.ReactNode; children: React.ReactNode; base?: string; demo?: boolean; readOnly?: boolean }) {
  const d = useDict();
  const t = d.cash;
  const path = usePathname();
  const base = baseIn ?? `/cash/${id}`;
  return (
    <TipProvider>
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 bg-bar px-3 text-[13px] text-[#ddd] no-print">
        <Link prefetch={false} href={demo ? "/" : "/companies"} className="rounded p-1.5 hover:bg-bar-2" aria-label={demo ? d.bottom.home : d.shell.backToCompanies}><ArrowLeft className="flip-rtl h-4 w-4" /></Link>
        <span className="truncate font-semibold text-white" data-testid="cash-name">{name}</span>
        <span className="rounded bg-bar-2 px-2 py-0.5 text-[11px] uppercase tracking-wider" data-testid="cash-tag">{t.tag}</span>
        <div className="ms-auto flex items-center gap-2">{demo && <span className="rounded bg-amber/90 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-bar" data-testid="cash-demo-badge">{d.shell.demoCompany}</span>}<LangSwitch compact />{right}</div>
      </header>
      <nav tabIndex={0} className="hidden gap-1 overflow-x-auto border-b border-line bg-white px-3 sm:flex sm:px-8 no-print" data-testid="cash-nav">
        {TABS.filter((k) => !demo || (k !== "upload" && k !== "settings")).map((k) => {
          const href = k ? `${base}/${k}` : base;
          const on = k ? path.startsWith(href) : path === base;
          return <Link prefetch={false} key={k} href={href} className={cn("-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm", on ? "border-brand-d font-semibold" : "border-transparent text-mute hover:text-ink")} data-testid={`cash-tab-${k || "overview"}`}>{t.nav[k]}</Link>;
        })}
      </nav>
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-6 sm:px-8 sm:pb-16">{children}</main>
      <CashBottomBar base={base} path={path} demo={demo} readOnly={readOnly} />
    </TipProvider>
  );
}

/** The cash book on a phone: Overview, Add (in the middle), Entries, and the other pages under More. */
function CashBottomBar({ base, path, demo, readOnly }: { base: string; path: string; demo: boolean; readOnly: boolean }) {
  const d = useDict();
  const t = d.cash;
  const on = path === base ? "" : path.startsWith(`${base}/entries`) ? "entries" : "more";
  const tab = (k: string) => cn("flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[11px]", on === k ? "font-semibold text-brand-d" : "text-[#555]");
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center border-t border-line bg-white pb-[env(safe-area-inset-bottom)] sm:hidden no-print" aria-label={d.shell.sections} data-testid="cash-bottom-bar">
      <Link prefetch={false} href={base} className={tab("")} aria-current={on === "" ? "page" : undefined} data-testid="cash-bottom-overview"><LayoutDashboard className="h-5 w-5" strokeWidth={1.7} />{t.nav[""]}</Link>
      {!readOnly && <Link prefetch={false} href={`${base}/entries`} className="flex flex-1 justify-center" aria-label={t.addEntry} data-testid="cash-bottom-add">
        <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-brand-d text-white shadow-lg"><Plus className="h-6 w-6" /></span>
      </Link>}
      <Link prefetch={false} href={`${base}/entries`} className={tab("entries")} aria-current={on === "entries" ? "page" : undefined} data-testid="cash-bottom-entries"><ListOrdered className="h-5 w-5" strokeWidth={1.7} />{t.nav.entries}</Link>
      <D.Root>
        <D.Trigger className={tab("more")} data-testid="cash-bottom-more"><Menu className="h-5 w-5" strokeWidth={1.7} />{d.bottom.more}</D.Trigger>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <D.Content className="fixed inset-x-0 bottom-0 z-50 rounded-t-xl bg-white px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3 shadow-2xl outline-none">
            <div className="mb-2 flex items-center justify-between">
              <D.Title className="text-sm font-semibold">{d.bottom.more}</D.Title>
              <D.Description className="sr-only">{d.bottom.more}</D.Description>
              <D.Close className="rounded p-2 text-mute hover:bg-band" aria-label={d.dialog.close}><X className="h-5 w-5" /></D.Close>
            </div>
            {(demo ? (["in", "out", "cash"] as const) : (["in", "out", "cash", "upload", "settings"] as const)).map((k) => (
              <D.Close asChild key={k}>
                <Link prefetch={false} href={`${base}/${k}`} className="flex min-h-11 items-center rounded-md px-3 py-2 text-sm hover:bg-band" data-testid={`cash-more-${k}`}>{t.nav[k]}</Link>
              </D.Close>
            ))}
          </D.Content>
        </D.Portal>
      </D.Root>
    </nav>
  );
}
