"use client";
// The page every module kept in the shared store gets (catalog, custom, Purchasing): its own period picker, filters on the
// fields it groups by, a tile per measure, the trend against last year, top values per dimension, its cross-checks and
// its rows. It works on its own data alone: it never waits for the books or another module.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { money } from "@/lib/engine/format";
import { moduleByKey } from "@/lib/modules/registry";
import { specToDef, type ModuleSpec } from "@/lib/modules/spec";
import { Cockpit, HeroKpi, KpiTile } from "@/components/viz/kpi";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { ColumnChart } from "@/components/charts/column-chart";
import { BarList } from "@/components/charts/bar-list";
import { useT } from "@/lib/i18n/use-t";
import { useCompany } from "@/lib/company/context";
import { usePeriod } from "@/lib/company/use-period";
import { PeriodPicker } from "@/components/shell/period-picker";
import { PageHeader } from "@/components/shell/page-header";
import { moduleWindow } from "@/lib/modules/view";
import { AgreesStrip } from "./agrees-strip";

export interface ModuleSummary {
  rows: number; docs: number; amount: number;
  periods: { period: string; amount: number; qty: number | null; rows: number }[];
  partners: { partner: string; amount: number; rows: number }[];
  dims?: Record<string, { value: string; amount: number; rows: number }[]>;
  measures?: Record<string, Record<string, number>>;
  batches: { id: string; filename: string | null; at: string; rows: number }[];
}
export interface ModuleRow { id: number; period: string; day: string | null; doc: string; partner: string; amount: number; qty: number | null; data: Record<string, string | number> }

export function ModulePage({ module, spec, summary, rows, base, opened = true, filters = {}, q = "", denied }: {
  module: string; spec?: ModuleSpec | null; summary: ModuleSummary | null; rows: ModuleRow[]; base: string;
  opened?: boolean; filters?: Record<string, string[]>; q?: string; denied?: boolean; cur?: string;
}) {
  const { d, lang, ml } = useT();
  const t = d.ink.page;
  const c = useCompany();
  const cur = c.settings.currency;
  const m = useMemo(() => moduleByKey(module) ?? (spec ? specToDef(spec) : null), [module, spec]);
  const own = (summary?.periods ?? []).map((p) => p.period).sort();
  const { sel } = usePeriod(own.length ? own : undefined);
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [search, setSearch] = useState(q);
  if (!m) return null;
  const name = lang === "ar" ? m.name.ar : m.name.en;
  const label = (k: string) => { const f = m.fields.find((x) => x.key === k); return f ? (lang === "ar" ? f.label.ar : f.label.en) : k; };
  const go = (patch: (p: URLSearchParams) => void) => { const n = new URLSearchParams(sp.toString()); patch(n); router.replace(`${path}?${n.toString()}`, { scroll: false }); };
  const head = (body: React.ReactNode) => (
    <div className="max-w-2xl" data-testid="module-empty">
      <h1 className="mb-2 text-3xl font-light">{name}</h1>
      <p className="mb-4 text-mute">{t.owns(lang === "ar" ? m.owns.ar : m.owns.en)}</p>
      {body}
    </div>
  );
  if (denied) return head(<p data-testid="module-denied">{t.denied}</p>);
  if (!summary || (!summary.rows && !summary.periods.length && !Object.keys(filters).length)) return head(<>
    {!opened && <p className="mb-3 text-sm text-mute" data-testid="module-closed">{t.closed}</p>}
    <p className="mb-4">{t.empty}</p>
    {!c.readOnly && <Link prefetch={false} href={`${base}/data/intake`} className="rounded-md bg-brand-d px-5 py-2 font-medium text-white">{t.upload}</Link>}
  </>);
  const w = moduleWindow(summary.periods, sel, c.settings.fyStartMonth, m.nature ?? "flow");
  const extra = [...new Set(rows.flatMap((r) => Object.keys(r.data ?? {})))].slice(0, 6);
  const measures = Object.entries(summary.measures ?? {});
  const inWindow = (byMonth: Record<string, number>) => w.periods.reduce((s, p) => s + (byMonth[p] ?? 0), 0);
  const active = Object.entries(filters).flatMap(([k, vs]) => vs.map((v) => ({ k, v })));
  return (
    <div data-testid="module-page" data-module={module}>
      <PageHeader title={name} right={<PeriodPicker own={own} />} />
      <p className="mb-4 text-mute">{t.owns(lang === "ar" ? m.owns.ar : m.owns.en)} {t.files(summary.batches.length)}.</p>
      {active.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm" data-testid="module-filters">
          <span className="text-mute">{t.filtered}:</span>
          {active.map(({ k, v }) => (
            <button key={`${k}=${v}`} type="button" className="rounded-full border border-brand bg-brand-bg px-3 py-0.5" data-testid={`filter-${k}`}
              onClick={() => go((p) => { const rest = p.getAll(`f.${k}`).filter((x) => x !== v); p.delete(`f.${k}`); rest.forEach((x) => p.append(`f.${k}`, x)); })}>
              {label(k)}: {v || "–"} ✕
            </button>
          ))}
          <button type="button" className="text-brand-d underline" onClick={() => go((p) => { for (const k of [...p.keys()]) if (k.startsWith("f.")) p.delete(k); })}>{t.clearFilters}</button>
        </div>
      )}
      <AgreesStrip input={{ generic: [{ key: module, periods: summary.periods }] }} />
      <Cockpit hero={<HeroKpi label={t.total} value={money(w.amount, cur)} delta={w.growth} deltaLabel={t.vsLastYear} now={summary.periods.map((p) => p.amount)} testId="module-total" />}>
        <KpiTile label={m.nature === "snapshot" ? t.held : t.rows} value={w.rows.toLocaleString("en-US")} testId="module-rows" />
        {w.qty !== null && <KpiTile label={t.qty} value={w.qty.toLocaleString("en-US")} testId="module-qty" />}
        {measures.map(([k, byMonth]) => <KpiTile key={k} label={label(k)} value={inWindow(byMonth).toLocaleString("en-US", { maximumFractionDigits: 2 })} testId={`module-measure-${k}`} />)}
        <KpiTile label={t.partners} value={summary.partners.length.toLocaleString("en-US")} />
      </Cockpit>
      <CardGrid>
        <ChartCard title={t.byMonth} table={{ head: [t.month, t.amount], rows: summary.periods.map((p) => [ml(p.period), money(p.amount, cur)]) }}>
          <ColumnChart labels={summary.periods.map((p) => ml(p.period))} series={[{ name: t.amount, values: summary.periods.map((p) => p.amount), color: "#0b6e70" }]} cur={cur} testId="module-months" />
        </ChartCard>
        {Object.entries(summary.dims ?? {}).map(([k, items]) => (
          <ChartCard key={k} title={`${t.by} ${label(k)}`} table={{ head: [label(k), t.amount], rows: items.map((x) => [x.value || "–", money(x.amount, cur)]) }}>
            <BarList items={items.map((x) => ({ key: x.value, label: x.value || "–", value: x.amount }))} cur={cur} testId={`module-dim-${k}`}
              onSelect={(v) => go((p) => { if (!p.getAll(`f.${k}`).includes(v)) p.append(`f.${k}`, v); })} />
          </ChartCard>
        ))}
        {m.party && (
          <ChartCard title={`${t.top} · ${label(m.party)}`}>
            <BarList items={summary.partners.slice(0, 10).map((p) => ({ key: p.partner || "-", label: p.partner || "-", value: p.amount }))} cur={cur} testId="module-partners"
              onSelect={(v) => go((p) => { if (!p.getAll("f.partner").includes(v)) p.append("f.partner", v); })} />
          </ChartCard>
        )}
      </CardGrid>
      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="t-card">{t.detail}</h2>
          <form onSubmit={(e) => { e.preventDefault(); go((p) => { if (search.trim()) p.set("q", search.trim()); else p.delete("q"); }); }}>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.search} aria-label={t.search} className="rounded border border-line px-2 py-1 text-sm" data-testid="module-search" />
          </form>
        </div>
        <div className="overflow-x-auto rounded border border-line">
          <table className="min-w-full text-sm" data-testid="module-table">
            <thead className="bg-band"><tr>{[t.day, label(m.doc ?? "doc"), label(m.party ?? "partner"), t.amount, t.qty, ...extra.map(label)].map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-1.5">{r.day ?? ml(r.period)}</td><td className="px-3 py-1.5">{r.doc}</td><td className="px-3 py-1.5">{r.partner}</td>
                <td className="num px-3 py-1.5">{money(r.amount, cur)}</td><td className="num px-3 py-1.5">{r.qty ?? ""}</td>
                {extra.map((k) => <td key={k} className="px-3 py-1.5">{String(r.data?.[k] ?? "")}</td>)}
              </tr>))}</tbody>
          </table>
        </div>
        {rows.length >= 200 && <p className="mt-2 text-xs text-mute">{t.first200}</p>}
      </section>
    </div>
  );
}
