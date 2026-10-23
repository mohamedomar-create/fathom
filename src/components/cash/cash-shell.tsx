"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useDict } from "@/lib/i18n/context";
import { LangSwitch } from "@/components/shell/lang-switch";
import { TipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

const TABS = ["", "in", "out", "cash", "entries", "upload", "settings"] as const;

/** The cash book's own frame: the business name, its seven pages, nothing from the full system. */
export function CashShell({ id, name, right, children }: { id: string; name: string; right?: React.ReactNode; children: React.ReactNode }) {
  const d = useDict();
  const t = d.cash;
  const path = usePathname();
  const base = `/cash/${id}`;
  return (
    <TipProvider>
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 bg-bar px-3 text-[13px] text-[#ddd] no-print">
        <Link prefetch={false} href="/companies" className="rounded p-1.5 hover:bg-bar-2" aria-label={d.shell.backToCompanies}><ArrowLeft className="flip-rtl h-4 w-4" /></Link>
        <span className="truncate font-semibold text-white" data-testid="cash-name">{name}</span>
        <span className="rounded bg-bar-2 px-2 py-0.5 text-[11px] uppercase tracking-wider" data-testid="cash-tag">{t.tag}</span>
        <div className="ms-auto flex items-center gap-2"><LangSwitch compact />{right}</div>
      </header>
      <nav className="flex gap-1 overflow-x-auto border-b border-line bg-white px-3 sm:px-8 no-print" data-testid="cash-nav">
        {TABS.map((k) => {
          const href = k ? `${base}/${k}` : base;
          const on = k ? path.startsWith(href) : path === base;
          return <Link prefetch={false} key={k} href={href} className={cn("-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm", on ? "border-brand-d font-semibold" : "border-transparent text-mute hover:text-ink")} data-testid={`cash-tab-${k || "overview"}`}>{t.nav[k]}</Link>;
        })}
      </nav>
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8">{children}</main>
    </TipProvider>
  );
}
