"use client";
import Link from "next/link";
import { useMemo } from "react";
import { Hospital } from "lucide-react";
import { money, pct } from "@/lib/engine";
import { resolveEndUsers, type EndUserData } from "@/lib/company/end-users-parse";
import { useCompany } from "@/lib/company/context";
import { useSales } from "@/lib/company/sales-context";
import { PageHeader } from "@/components/shell/page-header";
import { BarList } from "@/components/charts/bar-list";
import { useT } from "@/lib/i18n/use-t";
import { SalesTile } from "./common";

const near = (a: number, b: number) => Math.abs(a - b) < 1;

/**
 * Who really bought, for customers that buy on behalf of others (a buying agency billed for hospitals): every agency
 * pound placed on a hospital by an exact Odoo link, or listed as Unmapped. Checked month by month against the agency's
 * sales on the other Sales pages.
 */
export function SalesEndUsers({ data }: { data: EndUserData }) {
  const c = useCompany();
  const sales = useSales();
  const T = useT();
  const t = T.d.eu;
  const cur = c.settings.currency;
  const title = T.d.nav["sales/end-users"][1];
  const { analysis: a, match } = useMemo(() => resolveEndUsers(data), [data]);
  const check = useMemo(() => {
    const agencies = new Set(a.agencies);
    const bySales = new Map<string, number>();
    for (const r of sales.customers) if (agencies.has(r.c)) bySales.set(r.p, (bySales.get(r.p) ?? 0) + r.a);
    return a.months.filter((m) => !near(m.total, bySales.get(m.period) ?? 0)).map((m) => ({ period: m.period, here: m.total, sales: bySales.get(m.period) ?? 0 }));
  }, [a, sales.customers]);

  if (!a.total) {
    return (
      <>
        <PageHeader title={title} />
        <div className="mx-auto max-w-xl py-16 text-center" data-testid="no-end-users">
          <Hospital className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
          <h2 className="text-2xl font-light">{t.none}</h2>
          <p className="mt-2 text-mute">{t.noneText}</p>
          <p className="mt-3 text-[13.5px]">{t.noneHow}</p>
          {!c.readOnly && <Link href={`${c.basePath}/data/odoo`} className="mt-6 inline-block rounded bg-brand-d px-5 py-2.5 font-medium text-white">Odoo</Link>}
        </div>
      </>
    );
  }

  const years = [...new Set(a.months.map((m) => m.period.slice(0, 4)))].sort().slice(-4);
  const firstYear = years[0];
  const yearOf = (h: (typeof a.hospitals)[number], y: string) => Object.entries(h.byPeriod).filter(([p]) => p.startsWith(y)).reduce((s, [, v]) => s + v, 0);
  const earlier = (h: (typeof a.hospitals)[number]) => Object.entries(h.byPeriod).filter(([p]) => p.slice(0, 4) < firstYear).reduce((s, [, v]) => s + v, 0);
  const hasEarlier = a.hospitals.some((h) => earlier(h) !== 0);
  const unmapped = a.months.reduce((s, m) => s + m.unmapped, 0);
  const top = a.hospitals[0];
  const share = (v: number) => (a.total ? (v / a.total) * 100 : 0);
  const MAX = 60;
  const sumBy = (pick: (h: (typeof a.hospitals)[number]) => [string, number][]) => {
    const m = new Map<string, number>();
    for (const h of a.hospitals) for (const [k, v] of pick(h)) if (k) m.set(k, (m.get(k) ?? 0) + v);
    return [...m].sort((x, y) => y[1] - x[1]);
  };
  const funding = sumBy((h) => Object.entries(h.byFunding));
  const regions = sumBy((h) => Object.entries(h.byRegion));
  const notInvoiced = [...match.unmatchedLines.reduce((m, l) => { const k = l.day.slice(0, 7); const x = m.get(k) ?? [0, 0]; m.set(k, [x[0] + l.value, x[1] + 1]); return m; }, new Map<string, [number, number]>())]
    .map(([p, [v, n]]) => [p, v, n] as const).sort((x, y) => y[0].localeCompare(x[0]));
  return (
    <>
      <PageHeader title={title} />
      <p className="mb-1 text-[13.5px]" data-testid="eu-agencies">{t.agencies(a.agencies.join(" · "))}</p>
      <p className="mb-6 text-xs text-mute">{t.definition}</p>
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
        <SalesTile label={t.total} value={money(a.total, cur, true)} testId="eu-total" />
        <SalesTile label={t.hospitals} value={a.hospitals.length} />
        <SalesTile label={t.coverage} value={a.coverage === null ? "–" : pct(a.coverage * 100, 1)} neg={(a.coverage ?? 1) < 0.95} sub={<span className="text-mute">{t.exactOnly}</span>} testId="eu-coverage" />
        <SalesTile label={t.unmapped} value={money(unmapped, cur, true)} neg={Math.abs(unmapped) >= 1} sub={<span className="text-mute">{t.noLink}</span>} testId="eu-unmapped" />
        <SalesTile label={t.largest} value={top ? pct(share(top.amount), 0) : "–"} neg={top ? share(top.amount) > 20 : false} sub={<span className="text-mute">{top?.name ?? t.ofAgency}</span>} />
      </div>

      <div className={check.length ? "mb-8 rounded border border-red/40 bg-red/5 p-3 text-[13.5px]" : "mb-8 rounded border border-green/40 bg-green/5 p-3 text-[13.5px]"} data-testid="eu-check">
        {check.length ? (
          <>
            <b>{t.differs(check.length)}</b>
            <ul className="mt-1">{check.slice(0, 12).map((d) => <li key={d.period} className="num">{T.ml(d.period)}: {money(d.here, cur)} / {money(d.sales, cur)}</li>)}</ul>
          </>
        ) : t.ties(a.months.length)}
      </div>

      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-xl font-light">{t.hospitalsH}</h2>
          <BarList items={a.hospitals.map((h) => ({ key: h.key, label: h.name, value: h.amount, share: share(h.amount) }))} cur={cur} max={15} testId="eu-bars" />
        </div>
        <div>
          <h2 className="mb-3 text-xl font-light">{t.howH}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" data-testid="eu-months">
              <thead><tr className="label text-start"><th className="py-1 text-start">{t.month}</th><th className="text-end">{t.total2}</th><th className="text-end">{t.byOrder}</th><th className="text-end">{t.byContact}</th><th className="text-end">{t.byShipping}</th><th className="text-end">{t.byStatement}</th><th className="text-end">{t.byRegister}</th><th className="text-end">{t.unmapped}</th></tr></thead>
              <tbody>
                {[...a.months].reverse().slice(0, 24).map((m) => (
                  <tr key={m.period} className="border-t border-line">
                    <td className="py-1">{T.ml(m.period)}</td>
                    {[m.total, m.order, m.contact, m.shipping, m.statement, m.register].map((v, i) => <td key={i} className="num text-end">{v ? money(v, cur, true) : "–"}</td>)}
                    <td className={m.unmapped ? "num text-end text-red" : "num text-end"}>{m.unmapped ? money(m.unmapped, cur, true) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-mute">{t.howNote}</p>
        </div>
      </div>

      <h2 className="mb-3 mt-10 text-xl font-light">{t.allH}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]" data-testid="eu-table">
          <thead><tr className="label"><th className="py-1 text-start">{t.hospital}</th>{hasEarlier && <th className="text-end">{t.earlier}</th>}{years.map((y) => <th key={y} className="text-end">{y}</th>)}<th className="text-end">{t.total2}</th><th className="text-end">{t.share}</th><th className="text-start ps-4">{t.topCategory}</th><th className="text-start ps-4">{t.region}</th></tr></thead>
          <tbody>
            {a.hospitals.slice(0, MAX).map((h) => {
              const cat = Object.entries(h.byCategory).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "";
              return (
                <tr key={h.key} className="border-t border-line">
                  <td className="py-1">{h.name}</td>
                  {hasEarlier && <td className="num text-end">{money(earlier(h), cur, true)}</td>}
                  {years.map((y) => { const v = yearOf(h, y); return <td key={y} className="num text-end">{v ? money(v, cur, true) : "–"}</td>; })}
                  <td className="num text-end font-semibold">{money(h.amount, cur, true)}</td>
                  <td className="num text-end">{pct(share(h.amount), 1)}</td>
                  <td className="truncate ps-4 text-mute">{cat}</td><td className="ps-4 text-mute">{h.region}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {a.hospitals.length > MAX && <p className="mt-2 text-xs text-mute">{t.showing(MAX, a.hospitals.length)}</p>}

      {funding.length > 0 && (
        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="mb-1 text-xl font-light">{t.fundingH}</h2>
            <p className="mb-3 text-[13px] text-mute">{t.fundingNote}</p>
            <BarList items={funding.map(([k, v]) => ({ key: k, label: k, value: v, share: share(v) }))} cur={cur} max={12} testId="eu-funding" />
          </div>
          <div>
            <h2 className="mb-1 text-xl font-light">{t.regionH}</h2>
            <p className="mb-3 text-[13px] text-mute">{t.fundingNote}</p>
            <BarList items={regions.map(([k, v]) => ({ key: k, label: k, value: v, share: share(v) }))} cur={cur} max={12} testId="eu-regions" />
          </div>
        </div>
      )}
      {match.unmatchedLines.length > 0 && data.statement.length > 0 && (
        <>
          <h2 className="mb-1 mt-10 text-xl font-light">{t.notInvoicedH}</h2>
          <p className="mb-3 text-[13px] text-mute" data-testid="eu-not-invoiced">{t.notInvoicedText(money(match.unmatchedLines.reduce((x, l) => x + l.value, 0), cur, true), match.unmatchedLines.length)}</p>
          <table className="w-full text-[13px]">
            <thead><tr className="label"><th className="py-1 text-start">{t.month}</th><th className="text-end">{t.total2}</th><th className="text-end">{t.lines}</th></tr></thead>
            <tbody>{notInvoiced.slice(0, 18).map(([p, v, n]) => <tr key={p} className="border-t border-line"><td className="py-1">{T.ml(p)}</td><td className="num text-end">{money(v, cur, true)}</td><td className="num text-end">{n}</td></tr>)}</tbody>
          </table>
        </>
      )}

      {a.unmapped.length > 0 && (
        <>
          <h2 className="mb-1 mt-10 text-xl font-light">{t.unmappedH}</h2>
          <p className="mb-3 text-[13px] text-mute">{t.unmappedText} {!c.readOnly && <Link className="underline" href={`${c.basePath}/data/end-users`}>{t.fix}</Link>}</p>
          <table className="w-full text-[13px]" data-testid="eu-unmapped-list">
            <thead><tr className="label"><th className="py-1 text-start">{t.description}</th><th className="text-end">{t.total2}</th><th className="text-end">{t.lines}</th><th className="text-start ps-4">{t.months}</th></tr></thead>
            <tbody>
              {a.unmapped.slice(0, 40).map((u) => (
                <tr key={u.text} className="border-t border-line">
                  <td className="py-1">{u.text}</td>
                  <td className="num text-end">{money(u.amount, cur, true)}</td>
                  <td className="num text-end">{u.lines}</td>
                  <td className="ps-4 text-mute">{u.months.length > 3 ? `${T.ml(u.months[0])} – ${T.ml(u.months[u.months.length - 1])}` : u.months.map((m) => T.ml(m)).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {a.unmapped.length > 40 && <p className="mt-2 text-xs text-mute">{t.showing(40, a.unmapped.length)}</p>}
        </>
      )}
    </>
  );
}
