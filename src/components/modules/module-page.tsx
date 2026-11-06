"use client";
// The page every module added by definition gets: its headline total, rows, documents and partners, the total by month,
// the largest partners and the rows themselves. Bespoke pages (Sales, Expenses, Inventory, Payments) stay as they are.
import Link from "next/link";
import { money } from "@/lib/engine/format";
import { moduleByKey } from "@/lib/modules/registry";
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
  batches: { id: string; filename: string | null; at: string; rows: number }[];
}
export interface ModuleRow { id: number; period: string; day: string | null; doc: string; partner: string; amount: number; qty: number | null; data: Record<string, string | number> }

export function ModulePage({ module, summary, rows, cur, base }: { module: string; summary: ModuleSummary; rows: ModuleRow[]; cur: string; base: string }) {
  const { d, lang, ml } = useT();
  const t = d.ink.page;
  const m = moduleByKey(module)!;
  const c = useCompany();
  // The module's own months drive its period picker: it never waits for the books or another module.
  const own = summary.periods.map((p) => p.period).sort();
  const { sel } = usePeriod(own.length ? own : undefined);
  const name = lang === "ar" ? m.name.ar : m.name.en;
  const label = (k: string) => { const f = m.fields.find((x) => x.key === k); return f ? (lang === "ar" ? f.label.ar : f.label.en) : k; };
  if (!summary.rows) return (
    <div data-testid="module-empty" className="max-w-2xl">
      <h1 className="mb-2 text-3xl font-light">{name}</h1>
      <p className="mb-4 text-mute">{t.owns(lang === "ar" ? m.owns.ar : m.owns.en)}</p>
      <p className="mb-4">{t.empty}</p>
      <Link prefetch={false} href={`${base}/data/intake`} className="rounded-md bg-brand-d px-5 py-2 font-medium text-white">{t.upload}</Link>
    </div>
  );
  const extra = [...new Set(rows.flatMap((r) => Object.keys(r.data ?? {})))].slice(0, 6);
  const w = moduleWindow(summary.periods, sel, c.settings.fyStartMonth, m.nature ?? "flow");
  const inWindow = new Set(w.periods);
  const shown = rows.filter((r) => inWindow.has(r.period));
  return (
    <div data-testid="module-page" data-module={module}>
      <PageHeader title={name} right={<PeriodPicker own={own} />} />
      <p className="mb-5 text-mute">{t.owns(lang === "ar" ? m.owns.ar : m.owns.en)} {t.files(summary.batches.length)}.</p>
      <AgreesStrip input={{ generic: [{ key: module, periods: summary.periods }] }} />
      <Cockpit hero={<HeroKpi label={t.total} value={money(w.amount, cur)} delta={w.growth} deltaLabel={t.vsLastYear} now={summary.periods.map((p) => p.amount)} testId="module-total" />}>
        <KpiTile label={t.rows} value={w.rows.toLocaleString("en-US")} testId="module-rows" />
        {w.qty !== null && <KpiTile label={t.qty} value={w.qty.toLocaleString("en-US")} testId="module-qty" />}
        <KpiTile label={t.docs} value={summary.docs.toLocaleString("en-US")} sub={t.allTime} />
        <KpiTile label={t.partners} value={summary.partners.length.toLocaleString("en-US")} sub={t.allTime} />
      </Cockpit>
      <CardGrid>
        <ChartCard title={t.byMonth} table={{ head: [t.month, t.amount], rows: summary.periods.map((p) => [ml(p.period), money(p.amount, cur)]) }}>
          <ColumnChart labels={summary.periods.map((p) => ml(p.period))} series={[{ name: t.amount, values: summary.periods.map((p) => p.amount), color: "#0b6e70" }]} cur={cur} testId="module-months" />
        </ChartCard>
        <ChartCard title={`${t.top} · ${t.allTime}`}>
          <BarList items={summary.partners.slice(0, 10).map((p) => ({ key: p.partner || "-", label: p.partner || "-", value: p.amount }))} cur={cur} testId="module-partners" />
        </ChartCard>
      </CardGrid>
      <section className="mt-6">
        <h2 className="t-card mb-2">{t.detail}</h2>
        <div className="overflow-x-auto rounded border border-line">
          <table className="min-w-full text-sm" data-testid="module-table">
            <thead className="bg-band"><tr>{[t.day, label(m.doc ?? "doc"), label(m.party ?? "partner"), t.amount, t.qty, ...extra.map(label)].map((h) => <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-3 py-1.5">{r.day ?? ml(r.period)}</td><td className="px-3 py-1.5">{r.doc}</td><td className="px-3 py-1.5">{r.partner}</td>
                <td className="num px-3 py-1.5">{money(r.amount, cur)}</td><td className="num px-3 py-1.5">{r.qty ?? ""}</td>
                {extra.map((k) => <td key={k} className="px-3 py-1.5">{String(r.data?.[k] ?? "")}</td>)}
              </tr>))}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
