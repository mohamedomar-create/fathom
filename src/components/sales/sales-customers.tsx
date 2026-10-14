"use client";
import { money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { BarList } from "@/components/charts/bar-list";
import { DataNotes, FromAccountsNote, NoSales, SalesTable, SalesTile, useSalesAnalysis, SalesPicker } from "./common";

export function SalesCustomers() {
  const c = useCompany();
  const s = useSalesAnalysis();
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title="Customers" /><NoSales /></>;
  if (s.fromAccounts) return <><PageHeader title="Customers" right={<SalesPicker s={s} />} /><FromAccountsNote page="customers" /></>;
  const cu = s.customers;
  const cmpCol = s.compareLabel ? `vs ${s.compareLabel}` : "";
  return (
    <>
      <PageHeader title="Customers" right={<SalesPicker s={s} />} />
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-5">
        <SalesTile label="Active customers" value={cu.active} testId="tile-active" />
        <SalesTile label="New" value={cu.new ?? "–"} sub={<span className="text-mute">{cu.new === null ? "needs 3 earlier months" : "first purchase in this period"}</span>} />
        <SalesTile label="Returning" value={cu.returning ?? "–"} sub={<span className="text-mute">bought before too</span>} />
        <SalesTile label="Lost" value={cu.lost ?? "–"} neg={(cu.lost ?? 0) > 0} sub={<span className="text-mute">{cu.lost === null ? "needs 15 months of sales" : "none in the last 3 months"}</span>} testId="tile-lost" />
        <SalesTile label="Largest customer" value={cu.topShare === null ? "–" : pct(cu.topShare, 0)} neg={(cu.topShare ?? 0) > 20} sub={<span className="text-mute">{cu.topName ?? "of sales"}</span>} />
      </div>
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-xl font-light">Top customers</h2>
          <BarList items={s.byCustomer.filter((r) => r.amount > 0).map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={12} testId="customer-bars" />
          <p className="mt-3 text-[13px] text-mute">{cu.top10Share === null ? "" : `The ten largest customers make ${pct(cu.top10Share, 0)} of sales.`} {(cu.topShare ?? 0) > 20 ? "Banks and investors treat one customer above 20% as a concentration risk." : ""}</p>
        </div>
        <div>
          {cu.lostNames.length > 0 && (
            <>
              <h2 className="mb-3 text-xl font-light">Customers who stopped buying</h2>
              <p className="mb-2 text-[13px] text-mute">Bought in the year before and nothing in the last three months. Worth a call.</p>
              <ul className="columns-2 gap-6 text-[13px]" data-testid="lost-list">{cu.lostNames.map((n) => <li key={n} className="truncate py-0.5">{n}</li>)}</ul>
            </>
          )}
          {s.bySalesperson.length > 0 && (
            <>
              <h2 className="mb-3 mt-8 text-xl font-light">By salesperson</h2>
              <BarList items={s.bySalesperson.map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={10} />
            </>
          )}
          {s.bySeries.length > 1 && (
            <>
              <h2 className="mb-3 mt-8 text-xl font-light">By invoice series</h2>
              <BarList items={s.bySeries.map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={10} />
              <p className="mt-2 text-xs text-mute">From the invoice number prefix (for example INV, INV2, RINV for refunds).</p>
            </>
          )}
        </div>
      </div>
      <h2 className="mb-3 mt-10 text-xl font-light">All customers</h2>
      <SalesTable rows={s.byCustomer} cur={cur} nameLabel="Customer" compareLabel={cmpCol} invoices max={50} testId="customer-table" />
      <p className="mt-2 text-xs text-mute">Average invoice: {s.avgInvoice === null ? "–" : money(s.avgInvoice, cur)} across {s.invoices.toLocaleString("en-US")} invoices.</p>
      <DataNotes notes={s.notes} />
    </>
  );
}
