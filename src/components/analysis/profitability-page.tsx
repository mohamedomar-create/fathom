"use client";
import { money } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useComments, useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { BreakevenChart } from "@/components/charts/breakeven-chart";
import { EmptyState, MoneyTile, Notes } from "./common";
import { TopAccounts } from "./top-accounts";
import { useT } from "@/lib/i18n/use-t";

export function ProfitabilityPage() {
  const c = useCompany();
  const a = useAnalysis();
  const comments = useComments();
  const T = useT();
  const t = T.d.ana;
  if (!a) return null;
  const cur = c.settings.currency;
  const { P } = a.view;
  const b = a.breakeven;
  const periods = a.view.window.periods;
  return (
    <>
      <PageHeader title={T.d.nav["analysis/profitability"][1]} right={<PeriodPicker />} />
      <div className="mb-6 grid gap-6 sm:grid-cols-3">
        <MoneyTile label={t.grossProfit} value={P.gross_profit} testId="tile-gp" />
        <MoneyTile label={t.operatingProfit} value={P.operating_profit} />
        <MoneyTile label={t.ebit} value={P.ebit} />
      </div>
      {b.ok ? (
        <div className="grid items-start gap-8 lg:grid-cols-[1.3fr_1fr]">
          <div data-testid="breakeven-chart"><BreakevenChart revenue={b.revenue} fixed={b.fixedCosts} vcr={b.vcr} bep={b.bep} cur={cur} /></div>
          <div className="space-y-5">
            <h3 className="text-2xl font-normal">{t.breakeven}</h3>
            <Blk label={<><span className="text-green">●</span> {t.revenue}</>} value={money(b.revenue, cur)}>
              <TopAccounts title={t.topRevenue} classes={["revenue"]} periods={periods} total={P.revenue} />
            </Blk>
            <Blk label={<><span className="text-red">●</span> {t.totalCosts}</>} value={money(b.totalCosts, cur)}>
              <TopAccounts title={t.topCosts} classes={["cos_variable", "cos_fixed", "cos_depreciation", "exp_variable", "exp_fixed", "exp_depreciation"]} periods={periods} total={b.totalCosts} />
            </Blk>
            <Blk label={t.bep} value={money(b.bep, cur)} testId="bep" />
            <Blk label={t.mos} value={<span className={b.mos < 0 ? "text-red" : ""}>{money(b.mos, cur)} <span className="text-base text-mute">({b.mosPct.toFixed(0)}%)</span></span>} testId="mos" />
            <Blk label={<span className="text-red">{t.variable}</span>} value={<span className="text-base">{t.perUnit(cur, b.vcr.toFixed(2))}</span>} />
            <Blk label={t.fixed} value={<span className="text-base">{money(b.fixedCosts, cur)}</span>} />
          </div>
        </div>
      ) : (
        <EmptyState title={t.noProfitTool} text={b.reason === "no_revenue" ? t.noRevenue : t.varTooHigh} />
      )}
      <Notes findings={a.findings.filter((f) => f.section === "profitability")} comment={comments("profitability")} />
    </>
  );
}

function Blk({ label, value, children, testId }: { label: React.ReactNode; value: React.ReactNode; children?: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId}>
      <div className="label">{label}</div>
      <div className="num text-2xl">{value}</div>
      {children}
    </div>
  );
}
