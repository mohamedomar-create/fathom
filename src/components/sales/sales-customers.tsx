"use client";
import { money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { BarList } from "@/components/charts/bar-list";
import { DataNotes, FromAccountsNote, NoSales, SalesTable, SalesTile, useSalesAnalysis, SalesPicker } from "./common";
import { useT } from "@/lib/i18n/use-t";

export function SalesCustomers() {
  const c = useCompany();
  const s = useSalesAnalysis();
  const T = useT();
  const t = T.d.sales;
  const title = T.d.nav["sales/customers"][1];
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={title} /><NoSales /></>;
  if (s.fromAccounts) return <><PageHeader title={title} right={<SalesPicker s={s} />} /><FromAccountsNote page="customers" /></>;
  const cu = s.customers;
  const cmpCol = s.compareLabel ? t.vs(t.word[s.compareLabel] ?? s.compareLabel) : "";
  return (
    <>
      <PageHeader title={title} right={<SalesPicker s={s} />} />
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
        <SalesTile label={t.activeShort} value={cu.active} testId="tile-active" />
        <SalesTile label={t.newT} value={cu.new ?? "–"} sub={<span className="text-mute">{cu.new === null ? t.needs3 : t.firstPurchase}</span>} />
        <SalesTile label={t.returning} value={cu.returning ?? "–"} sub={<span className="text-mute">{t.boughtBefore}</span>} />
        <SalesTile label={t.lost} value={cu.lost ?? "–"} neg={(cu.lost ?? 0) > 0} sub={<span className="text-mute">{cu.lost === null ? t.needs15 : t.noneLast3}</span>} testId="tile-lost" />
        <SalesTile label={t.largestCustomer} value={cu.topShare === null ? "–" : pct(cu.topShare, 0)} neg={(cu.topShare ?? 0) > 20} sub={<span className="text-mute">{cu.topName ?? t.ofSales}</span>} />
      </div>
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-xl font-light">{t.topCustomers}</h2>
          <BarList items={s.byCustomer.map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount, share: r.share }))} cur={cur} max={12} testId="customer-bars" />
          <p className="mt-3 text-[13px] text-mute">{cu.top10Share === null ? "" : t.top10Text(pct(cu.top10Share, 0))} {(cu.topShare ?? 0) > 20 ? t.concentration : ""}</p>
        </div>
        <div>
          {cu.lostNames.length > 0 && (
            <>
              <h2 className="mb-3 text-xl font-light">{t.stopped}</h2>
              <p className="mb-2 text-[13px] text-mute">{t.stoppedText}</p>
              <ul className="columns-2 gap-6 text-[13px]" data-testid="lost-list">{cu.lostNames.map((n) => <li key={n} className="truncate py-0.5">{n}</li>)}</ul>
            </>
          )}
          {s.bySalesperson.length > 0 && (
            <>
              <h2 className="mb-3 mt-8 text-xl font-light">{t.bySalesperson}</h2>
              <BarList items={s.bySalesperson.map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={10} />
            </>
          )}
          {s.bySeries.length > 1 && (
            <>
              <h2 className="mb-3 mt-8 text-xl font-light">{t.bySeries}</h2>
              <BarList items={s.bySeries.map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={10} />
              <p className="mt-2 text-xs text-mute">{t.seriesNote}</p>
            </>
          )}
        </div>
      </div>
      <h2 className="mb-3 mt-10 text-xl font-light">{t.allCustomers}</h2>
      <SalesTable rows={s.byCustomer} cur={cur} nameLabel={t.customer} compareLabel={cmpCol} invoices max={50} testId="customer-table" />
      <p className="mt-2 text-xs text-mute">{t.avgLine(s.avgInvoice === null ? "–" : money(s.avgInvoice, cur), s.invoices)}</p>
      <DataNotes notes={s.notes} />
    </>
  );
}
