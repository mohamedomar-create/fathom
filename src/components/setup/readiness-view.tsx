"use client";
import Link from "next/link";
import { CheckCircle2, ChevronDown, CircleDashed, Download, AlertTriangle } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBooksFromZero } from "@/app/company/[id]/settings/actions";
import { useCompany } from "@/lib/company/context";
import { useSales } from "@/lib/company/sales-context";
import { useExpenses } from "@/lib/company/expenses-context";
import { useInventory } from "@/lib/company/inventory-context";
import { runChecks } from "@/lib/company/checks";
import { readiness, type ReadinessItem, type ReadinessSector, type SectorReadiness } from "@/lib/company/readiness";
import type { ExpensesData, SalesData } from "@/lib/engine";
import type { InventoryData } from "@/lib/engine/inventory";
import type { PaymentsBundle } from "@/lib/company/payments-load";
import type { TemplateKind } from "@/lib/templates/spec";
import { RadarChart, RadarLegend } from "@/components/charts/radar-chart";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

/** The link that downloads a blank template for this company's financial year and currency. */
export function templateHref(kind: TemplateKind, c: { name: string; settings: { currency: string; fyStartMonth: number } }, lang: "en" | "ar" = "en") {
  const q = new URLSearchParams({ fy: String(c.settings.fyStartMonth), currency: /^[A-Z]{3}$/.test(c.settings.currency) ? c.settings.currency : "EGP", company: c.name.slice(0, 80), lang });
  return `/api/templates/${kind}?${q}`;
}

/** The financials template filled with what the company holds (every month, codes, classes); members only. */
export function dataTemplateHref(id: string, lang: "en" | "ar" = "en") {
  return `/api/templates/financials?${new URLSearchParams({ id, data: "1", lang })}`;
}

export function TemplateButton({ kind, compact = false }: { kind: TemplateKind; compact?: boolean }) {
  const c = useCompany();
  const T = useT();
  const t = T.d.dat.ready;
  const cls = cn("inline-flex items-center gap-1.5 rounded border border-brand-d text-brand-d hover:bg-brand-bg", compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm");
  // With figures stored: the template filled with them, and a blank one for every month since the books begin.
  const months = kind === "financials" && c.source !== "demo" ? [...new Set(c.accounts.flatMap((a) => Object.keys(a.amounts)))].sort() : [];
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const run = months.length ? `${templateHref(kind, c, T.lang)}&${new URLSearchParams({ from: months[0], to: months[months.length - 1] > thisMonth ? months[months.length - 1] : thisMonth })}` : "";
  return (
    <>
      <a href={templateHref(kind, c, T.lang)} download className={cls} data-testid={`template-${kind}`}>
        <Download className="h-3.5 w-3.5" />{t.download(t.template[kind])}
      </a>
      {months.length > 0 && (
        <>
          <a href={dataTemplateHref(c.id, T.lang)} download className={cls} data-testid="template-financials-data"><Download className="h-3.5 w-3.5" />{t.withData}</a>
          <a href={run} download className={cls} data-testid="template-financials-all"><Download className="h-3.5 w-3.5" />{t.allMonths(months[0])}</a>
        </>
      )}
    </>
  );
}

/** All sectors' readiness for the company (checks, sales and expense lines, and stock included when available). */
export function useReadiness(sales?: SalesData | null, expenses?: ExpensesData | null, inventory?: InventoryData | null, payments?: PaymentsBundle | null): SectorReadiness[] {
  const c = useCompany();
  const { lang } = useT();
  return useMemo(() => readiness({
    months: c.months, unit: c.unit, checks: runChecks({ accounts: c.accounts, months: c.months, unit: c.unit }), fyStart: c.settings.fyStartMonth,
    sales, expenses, inventory, accounts: c.accounts, locationTypes: c.inventorySettings?.locationTypes, assumptions: c.assumptions, forecast: c.forecast, booksFromZero: c.booksFromZero,
    payments: payments ?? undefined, basis: c.booksBasis, lang,
  }), [c.months, c.accounts, c.settings.fyStartMonth, c.assumptions, c.forecast, c.booksFromZero, c.booksBasis, c.inventorySettings, c.unit, sales, expenses, inventory, payments, lang]);
}

function Icon({ s }: { s: ReadinessItem["status"] }) {
  return s === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-d" /> : s === "partial" ? <AlertTriangle className="h-4 w-4 shrink-0 text-[#7d5600]" /> : <CircleDashed className="h-4 w-4 shrink-0 text-red" />;
}

function Score({ label, v, testId }: { label: string; v: number | null; testId?: string }) {
  const t = useT().d.dat.ready;
  return (
    <div data-testid={testId}>
      <div className="label">{label}</div>
      <div className={cn("num text-2xl", v === null ? "text-mute" : v >= 90 ? "text-green-d" : v >= 60 ? "text-[#7d5600]" : "text-red")} title={v === null ? t.nothingToCheck : undefined}>{v === null ? "–" : `${v}%`}</div>
    </div>
  );
}

/** No history before the first month (a company that started on Odoo): the opening balance is zero, not missing. */
function BooksFromZero() {
  const c = useCompany();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const t = useT().d.dat.ready;
  if (c.readOnly || c.basePath === "/demo") return null;
  return (
    <>
      <button disabled={pending} onClick={() => start(async () => { const r = await setBooksFromZero(c.id, true); if (r.ok) router.refresh(); else setErr(r.error ?? t.couldNotSave); })}
        className="inline-flex items-center rounded border border-brand-d px-2 py-1 text-xs text-brand-d hover:bg-brand-bg" data-testid="books-from-zero">{t.fromZero}</button>
      {err && <span className="text-red">{err}</span>}
    </>
  );
}

export function FixLine({ item, basePath }: { item: ReadinessItem; basePath: string }) {
  const f = item.fix;
  const t = useT().d.dat.ready;
  if (!f) return null;
  return (
    <div className="mt-1 text-[12.5px]">
      <div><b>{t.what}</b> {f.what}.</div>
      <div className="text-mute"><b className="text-ink">{t.how}</b> {f.how}</div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {f.template && <TemplateButton kind={f.template} compact />}
        {f.href && <Link href={`${basePath}/${f.href}`} className="inline-flex items-center rounded bg-brand-d px-2 py-1 text-xs text-white">{t.go}</Link>}
        {item.id === "opening" && <BooksFromZero />}
      </div>
    </div>
  );
}

/** One sector: its radar, the two scores and every item with what to do about it. */
export function SectorPanel({ r, basePath }: { r: SectorReadiness; basePath: string }) {
  const t = useT().d.dat.ready;
  return (
    <section className="rounded-lg border border-line p-4" data-testid={`readiness-${r.key}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-medium">{r.label}</h3>
        {!r.unread && !r.pending && <RadarLegend />}
      </div>
      {r.pending ? (
        <p role="status" className="rounded border border-line bg-band px-4 py-3 text-sm" data-testid={`readiness-pending-${r.key}`}>
          {t.pending}
        </p>
      ) : r.unread ? (
        <p role="status" className="rounded border border-amber/60 bg-amber/10 px-4 py-3 text-sm" data-testid={`readiness-unread-${r.key}`}>
          {t.unread}
        </p>
      ) : (
      <div className="grid gap-4 lg:grid-cols-[390px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <RadarChart axes={r.items.map((i) => ({ label: i.axis, completion: i.completion, accuracy: i.accuracy }))} size={250} testId={`radar-${r.key}`} />
          <div className="flex gap-8"><Score label={t.complete} v={r.completion} testId={`score-complete-${r.key}`} /><Score label={t.accurate} v={r.accuracy} testId={`score-accurate-${r.key}`} /></div>
        </div>
        <ul className="divide-y divide-line">
          {r.items.map((i) => (
            <li key={i.id} className="py-2.5" data-testid={`ready-item-${r.key}-${i.id}`} data-status={i.status}>
              <div className="flex items-start gap-2">
                <Icon s={i.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{i.title}</span><span className="num text-xs text-mute">{t.scores(i.completion, i.accuracy)}</span></div>
                  <div className="text-[12.5px] text-mute">{i.detail}</div>
                  {i.status !== "done" && <FixLine item={i} basePath={basePath} />}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      )}
    </section>
  );
}

const KEY = "ireport:readiness-card";
// Whether the card is folded, remembered in this browser (an unavailable storage just keeps it open).
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const readOpen = (sector: string) => { try { return localStorage.getItem(`${KEY}:${sector}`) !== "closed"; } catch { return true; } };

/**
 * A small card at the top of a sector's first page: the radar, the two scores and the next thing to fix.
 * It folds away (remembered in this browser) and disappears once the sector's data is complete and accurate.
 */
export function ReadinessCard({ sector }: { sector: ReadinessSector }) {
  const c = useCompany();
  const t = useT().d.dat.ready;
  const sales = useSales();
  const expenses = useExpenses();
  const inventory = useInventory();
  // The stock checks compare against the cost of goods sold in the expense lines, so Inventory reads them too.
  const all = useReadiness(sector === "sales" ? sales : null, sector === "expenses" || sector === "inventory" ? expenses : null, sector === "inventory" ? inventory : null);
  const r = all.find((x) => x.key === sector)!;
  const open = useSyncExternalStore(subscribe, () => readOpen(sector), () => true);
  const toggle = () => { try { localStorage.setItem(`${KEY}:${sector}`, open ? "closed" : "open"); } catch { /* storage unavailable */ } listeners.forEach((l) => l()); };
  if (r.completion >= 100 && (r.accuracy === null || r.accuracy >= 100)) return null;
  const next = r.items.find((i) => i.status === "missing") ?? r.items.find((i) => i.status === "partial");
  return (
    <div className="mb-6 rounded-lg border border-line bg-band/60" data-testid={`readiness-card-${sector}`}>
      <button onClick={toggle} className="flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm" aria-expanded={open}>
        <span className="font-medium">{t.readiness}</span>
        <span className="num text-mute">{t.scores(r.completion, r.accuracy)}</span>
        <ChevronDown className={cn("ms-auto h-4 w-4 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-3">
          <RadarChart axes={r.items.map((i) => ({ label: i.axis, completion: i.completion, accuracy: i.accuracy }))} size={150} compact testId={`radar-card-${sector}`} />
          {next && (
            // At least 14rem wide, so on a phone the text wraps below the chart instead of being squeezed beside it.
            <div className="min-w-[14rem] flex-1" data-testid={`readiness-next-${sector}`}>
              <div className="text-sm"><span className="label me-2">{t.next}</span><b>{next.title}</b></div>
              <div className="text-[12.5px] text-mute">{next.detail}</div>
              <FixLine item={next} basePath={c.basePath} />
            </div>
          )}
          <Link href={`${c.basePath}/data`} className="text-sm text-brand-d underline" data-testid="readiness-setup-link">{t.seeAll}</Link>
        </div>
      )}
    </div>
  );
}
