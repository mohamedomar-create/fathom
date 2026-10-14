"use client";
import { money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { BarList } from "@/components/charts/bar-list";
import { DataNotes, ExpensesPicker, ExpenseTable, LenderTable, NoExpenses, NoLines, Tile, useExpensesAnalysis } from "./common";
import { CheckThese } from "./expenses-overview";

export function ExpensesSuppliers() {
  const c = useCompany();
  const s = useExpensesAnalysis();
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title="Suppliers" /><NoExpenses /></>;
  if (!s.lines.has) return <><PageHeader title="Suppliers" right={<ExpensesPicker s={s} />} /><NoLines /><DataNotes notes={s.notes} /></>;
  const cn = s.concentration;
  return (
    <>
      <PageHeader title="Suppliers" right={<ExpensesPicker s={s} />} />
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Tile label="Suppliers paid" value={cn.suppliers.toLocaleString("en-US")} sub={<span className="text-mute">{cn.newCount === null ? "new suppliers need earlier months" : `${cn.newCount} new this period`}</span>} testId="tile-supplier-count" />
        <Tile label="Largest supplier" value={cn.topShare === null ? "–" : pct(cn.topShare, 0)} sub={<span className="text-mute">{cn.topName ?? "of named spend"}</span>} neg={(cn.topShare ?? 0) > 25} />
        <Tile label="Top 5 suppliers" value={cn.top5Share === null ? "–" : pct(cn.top5Share, 0)} sub={<span className="text-mute">of named spend</span>} neg={(cn.top5Share ?? 0) > 60} />
        <Tile label="Lines cover" value={s.lines.coverage === null ? "–" : pct(Math.min(s.lines.coverage, 999), 0)} sub={<span className="text-mute">of P&amp;L costs</span>} neg={s.lines.coverage !== null && Math.abs(s.lines.coverage - 100) > 0.5} />
      </div>
      <h2 className="mb-3 text-xl font-light">Who you pay</h2>
      <ExpenseTable rows={s.bySupplier} cur={cur} nameLabel="Supplier" compareLabel={s.compareLabel} kind="suppliers" max={40} testId="supplier-table" />
      {s.stockBought > 0 && <p className="mt-2 text-[13px] text-mute" data-testid="stock-note">Includes {money(s.stockBought, cur)} of goods bought for stock. They reach your costs as cost of goods sold when sold, so they are not in the cost totals.</p>}
      {s.byLender.length > 0 && <>
        <h3 className="mb-2 mt-8 text-lg font-normal">Banks and lenders</h3>
        <p className="mb-2 text-[13px] text-mute">Interest and bank charges, by the bank that lends to you or keeps your account. Banks are not suppliers, so they are not in the list above. Costs only paid through a bank (salaries, rent) stay with what they are for.</p>
        <LenderTable s={s} cur={cur} />
      </>}
      {s.alsoCustomers.length > 0 && <>
        <h3 className="mb-2 mt-8 text-lg font-normal">Also your customers: check these</h3>
        <p className="mb-2 text-[13px] text-mute">These partners buy from you too. Their cost lines may be cost of goods sold to them rather than purchases.</p>
        <ExpenseTable rows={s.alsoCustomers} cur={cur} nameLabel="Partner" compareLabel={s.compareLabel} kind="suppliers" max={20} testId="also-customers" />
      </>}
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-lg font-normal">Where the lines came from</h3>
          <BarList items={s.bySource.map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={8} testId="source-bars" />
        </div>
        <div>
          <h3 className="mb-2 text-lg font-normal">By category</h3>
          <BarList items={s.byCategory.filter((r) => r.amount > 0).map((r) => ({ key: r.key, label: r.name, value: r.amount, share: r.share }))} cur={cur} max={8} testId="category-bars" />
          <CheckThese s={s} cur={cur} />
        </div>
      </div>
      <DataNotes notes={s.notes} />
    </>
  );
}
