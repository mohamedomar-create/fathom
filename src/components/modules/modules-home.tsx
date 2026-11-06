"use client";
// The company home without the books: each module that holds data, from its own figures, with a link to its pages.
import Link from "next/link";
import { money } from "@/lib/engine/format";
import { moduleByKey } from "@/lib/modules/registry";
import { useCompany } from "@/lib/company/context";
import { useDict, useLang } from "@/lib/i18n/context";
import { monthLabel } from "@/lib/i18n";
import type { ModuleCard } from "@/lib/company/module-overview";

const HREF: Record<string, string> = { sales: "sales", expenses: "expenses", inventory: "inventory", payments: "payments/flows", ar_open: "payments/receivables", ap_open: "payments/payables" };

export function ModulesHome({ cards }: { cards: ModuleCard[] }) {
  const c = useCompany();
  const d = useDict();
  const lang = useLang();
  const name = (k: string) => (d.sectors as Record<string, string>)[k] ?? (() => { const m = moduleByKey(k); return m ? (lang === "ar" ? m.name.ar : m.name.en) : k; })();
  return (
    <div data-testid="modules-home" className="mx-auto max-w-5xl py-6">
      <h1 className="mb-1 text-3xl font-light">{d.noData.home}</h1>
      <p className="mb-6 text-mute">{cards.length ? d.noData.homeBody(c.name) : d.noData.homeNone}</p>
      {cards.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((x) => (
            <Link key={x.key} prefetch={false} href={`${c.basePath}/${HREF[x.key] ?? `modules/${x.key}`}`} data-testid={`home-card-${x.key}`}
              className="rounded-xl border border-line bg-white p-5 transition hover:border-brand">
              <div className="t-card mb-2">{name(x.key)}</div>
              {x.amount !== null && <div className="num mb-1 text-2xl font-light">{money(x.amount, c.settings.currency)}</div>}
              <div className="text-sm text-mute">{d.noData.latest(monthLabel(x.latest, lang))} · {d.noData.monthsLoaded(x.months)}</div>
              <div className="mt-3 text-sm font-medium text-brand-d">{d.noData.open} →</div>
            </Link>
          ))}
        </div>
      )}
      {!c.readOnly && <Link prefetch={false} href={`${c.basePath}/data`} className="mt-8 inline-block rounded bg-brand-d px-5 py-2.5 font-medium text-white">{d.noData.add}</Link>}
    </div>
  );
}
