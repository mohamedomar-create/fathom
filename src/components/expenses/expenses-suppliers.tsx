"use client";
import { money, pct } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { PageHeader } from "@/components/shell/page-header";
import { BarList } from "@/components/charts/bar-list";
import { DataNotes, ExpensesPicker, ExpenseTable, LenderTable, NoExpenses, NoLines, Tile, useExpensesAnalysis } from "./common";
import { CheckThese } from "./expenses-overview";
import { useT } from "@/lib/i18n/use-t";

export function ExpensesSuppliers() {
  const c = useCompany();
  const s = useExpensesAnalysis();
  const T = useT();
  const t = T.d.exp;
  const title = T.d.nav["expenses/suppliers"][1];
  const cur = c.settings.currency;
  if (!s) return <><PageHeader title={title} /><NoExpenses /></>;
  if (!s.lines.has) return <><PageHeader title={title} right={<ExpensesPicker s={s} />} /><NoLines /><DataNotes notes={s.notes} /></>;
  const cn = s.concentration;
  return (
    <>
      <PageHeader title={title} right={<ExpensesPicker s={s} />} />
      <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Tile label={t.suppliersCount} value={cn.suppliers.toLocaleString("en-US")} sub={<span className="text-mute">{cn.newCount === null ? t.newNeed : t.newThis(cn.newCount)}</span>} testId="tile-supplier-count" />
        <Tile label={t.largestSupplier} value={cn.topShare === null ? "–" : pct(cn.topShare, 0)} sub={<span className="text-mute">{cn.topName ?? t.ofNamed}</span>} neg={(cn.topShare ?? 0) > 25} />
        <Tile label={t.top5} value={cn.top5Share === null ? "–" : pct(cn.top5Share, 0)} sub={<span className="text-mute">{t.ofNamed}</span>} neg={(cn.top5Share ?? 0) > 60} />
        <Tile label={t.linesCover} value={s.lines.coverage === null ? "–" : pct(Math.min(s.lines.coverage, 999), 0)} sub={<span className="text-mute">{t.ofPlCosts}</span>} neg={s.lines.coverage !== null && Math.abs(s.lines.coverage - 100) > 0.5} />
      </div>
      <h2 className="mb-3 text-xl font-light">{t.whoYouPay}</h2>
      <ExpenseTable rows={s.bySupplier} cur={cur} nameLabel={t.supplier} compareLabel={s.compareLabel} kind="suppliers" max={40} testId="supplier-table" />
      {s.stockBought > 0 && <p className="mt-2 text-[13px] text-mute" data-testid="stock-note">{t.stockNote(money(s.stockBought, cur))}</p>}
      {s.byLender.length > 0 && <>
        <h3 className="mb-2 mt-8 text-lg font-normal">{t.banksH}</h3>
        <p className="mb-2 text-[13px] text-mute">{t.banksText}</p>
        <LenderTable s={s} cur={cur} />
      </>}
      {s.alsoCustomers.length > 0 && <>
        <h3 className="mb-2 mt-8 text-lg font-normal">{t.alsoCustomers}</h3>
        <p className="mb-2 text-[13px] text-mute">{t.alsoText}</p>
        <ExpenseTable rows={s.alsoCustomers} cur={cur} nameLabel={t.partner} compareLabel={s.compareLabel} kind="suppliers" max={20} testId="also-customers" />
      </>}
      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-lg font-normal">{t.sources}</h3>
          <BarList items={s.bySource.map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount, share: r.share }))} cur={cur} max={8} testId="source-bars" />
        </div>
        <div>
          <h3 className="mb-2 text-lg font-normal">{t.byCategory}</h3>
          <BarList items={s.byCategory.filter((r) => r.amount > 0).map((r) => ({ key: r.key, label: T.tl(r.name), value: r.amount, share: r.share }))} cur={cur} max={8} testId="category-bars" />
          <CheckThese s={s} cur={cur} />
        </div>
      </div>
      <DataNotes notes={s.notes} />
    </>
  );
}
