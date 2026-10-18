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
import type { TemplateKind } from "@/lib/templates/spec";
import { RadarChart, RadarLegend } from "@/components/charts/radar-chart";
import { cn } from "@/lib/cn";

/** The link that downloads a blank template for this company's financial year and currency. */
export function templateHref(kind: TemplateKind, c: { name: string; settings: { currency: string; fyStartMonth: number } }) {
  const q = new URLSearchParams({ fy: String(c.settings.fyStartMonth), currency: /^[A-Z]{3}$/.test(c.settings.currency) ? c.settings.currency : "EGP", company: c.name.slice(0, 80) });
  return `/api/templates/${kind}?${q}`;
}

const TEMPLATE_NAME: Record<TemplateKind, string> = { financials: "monthly financials template", sales: "sales template", expenses: "expenses template" };

export function TemplateButton({ kind, compact = false }: { kind: TemplateKind; compact?: boolean }) {
  const c = useCompany();
  return (
    <a href={templateHref(kind, c)} download className={cn("inline-flex items-center gap-1.5 rounded border border-brand-d text-brand-d hover:bg-brand-bg", compact ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm")} data-testid={`template-${kind}`}>
      <Download className="h-3.5 w-3.5" />Download the {TEMPLATE_NAME[kind]}
    </a>
  );
}

/** All sectors' readiness for the company (checks, sales and expense lines, and stock included when available). */
export function useReadiness(sales?: SalesData | null, expenses?: ExpensesData | null, inventory?: InventoryData | null): SectorReadiness[] {
  const c = useCompany();
  return useMemo(() => readiness({
    months: c.months, checks: runChecks({ accounts: c.accounts, months: c.months }), fyStart: c.settings.fyStartMonth,
    sales, expenses, inventory, accounts: c.accounts, assumptions: c.assumptions, forecast: c.forecast, booksFromZero: c.booksFromZero,
  }), [c.months, c.accounts, c.settings.fyStartMonth, c.assumptions, c.forecast, c.booksFromZero, sales, expenses, inventory]);
}

function Icon({ s }: { s: ReadinessItem["status"] }) {
  return s === "done" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-d" /> : s === "partial" ? <AlertTriangle className="h-4 w-4 shrink-0 text-[#9a6b00]" /> : <CircleDashed className="h-4 w-4 shrink-0 text-red" />;
}

function Score({ label, v, testId }: { label: string; v: number | null; testId?: string }) {
  return (
    <div data-testid={testId}>
      <div className="label">{label}</div>
      <div className={cn("num text-2xl", v === null ? "text-mute" : v >= 90 ? "text-green-d" : v >= 60 ? "text-[#9a6b00]" : "text-red")} title={v === null ? "Nothing loaded here can be checked yet" : undefined}>{v === null ? "–" : `${v}%`}</div>
    </div>
  );
}

/** No history before the first month (a company that started on Odoo): the opening balance is zero, not missing. */
function BooksFromZero() {
  const c = useCompany();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  if (c.readOnly || c.basePath === "/demo") return null;
  return (
    <>
      <button disabled={pending} onClick={() => start(async () => { const r = await setBooksFromZero(c.id, true); if (r.ok) router.refresh(); else setErr(r.error ?? "Could not save"); })}
        className="inline-flex items-center rounded border border-brand-d px-2 py-1 text-xs text-brand-d hover:bg-brand-bg" data-testid="books-from-zero">My books start from zero (no history before)</button>
      {err && <span className="text-red">{err}</span>}
    </>
  );
}

export function FixLine({ item, basePath }: { item: ReadinessItem; basePath: string }) {
  const f = item.fix;
  if (!f) return null;
  return (
    <div className="mt-1 text-[12.5px]">
      <div><b>What:</b> {f.what}.</div>
      <div className="text-mute"><b className="text-ink">How:</b> {f.how}</div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {f.template && <TemplateButton kind={f.template} compact />}
        {f.href && <Link href={`${basePath}/${f.href}`} className="inline-flex items-center rounded bg-brand-d px-2 py-1 text-xs text-white">Go there</Link>}
        {item.id === "opening" && <BooksFromZero />}
      </div>
    </div>
  );
}

/** One sector: its radar, the two scores and every item with what to do about it. */
export function SectorPanel({ r, basePath }: { r: SectorReadiness; basePath: string }) {
  return (
    <section className="rounded-lg border border-line p-4" data-testid={`readiness-${r.key}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-medium">{r.label}</h3>
        <RadarLegend />
      </div>
      <div className="grid gap-4 lg:grid-cols-[390px_1fr]">
        <div className="flex flex-col items-center gap-3">
          <RadarChart axes={r.items.map((i) => ({ label: i.axis, completion: i.completion, accuracy: i.accuracy }))} size={250} testId={`radar-${r.key}`} />
          <div className="flex gap-8"><Score label="Complete" v={r.completion} testId={`score-complete-${r.key}`} /><Score label="Accurate" v={r.accuracy} testId={`score-accurate-${r.key}`} /></div>
        </div>
        <ul className="divide-y divide-line">
          {r.items.map((i) => (
            <li key={i.id} className="py-2.5" data-testid={`ready-item-${r.key}-${i.id}`} data-status={i.status}>
              <div className="flex items-start gap-2">
                <Icon s={i.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="font-medium">{i.title}</span><span className="num text-xs text-mute">{i.completion}% complete{i.accuracy !== null ? ` · ${i.accuracy}% accurate` : ""}</span></div>
                  <div className="text-[12.5px] text-mute">{i.detail}</div>
                  {i.status !== "done" && <FixLine item={i} basePath={basePath} />}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
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
        <span className="font-medium">Data readiness</span>
        <span className="num text-mute">{r.completion}% complete{r.accuracy !== null ? ` · ${r.accuracy}% accurate` : ""}</span>
        <ChevronDown className={cn("ms-auto h-4 w-4 transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-3">
          <RadarChart axes={r.items.map((i) => ({ label: i.axis, completion: i.completion, accuracy: i.accuracy }))} size={150} compact testId={`radar-card-${sector}`} />
          {next && (
            <div className="min-w-0 flex-1">
              <div className="text-sm"><span className="label me-2">Next</span><b>{next.title}</b></div>
              <div className="text-[12.5px] text-mute">{next.detail}</div>
              <FixLine item={next} basePath={c.basePath} />
            </div>
          )}
          <Link href={`${c.basePath}/settings/data-setup`} className="text-sm text-brand-d underline" data-testid="readiness-setup-link">See every step</Link>
        </div>
      )}
    </div>
  );
}
