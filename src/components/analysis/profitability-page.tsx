"use client";
import { money } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { BreakevenChart } from "@/components/charts/breakeven-chart";
import { EmptyState, MoneyTile, Notes } from "./common";
import { TopAccounts } from "./top-accounts";

export function ProfitabilityPage() {
  const c = useCompany();
  const a = useAnalysis();
  if (!a) return null;
  const cur = c.settings.currency;
  const { P } = a.view;
  const b = a.breakeven;
  const periods = a.view.window.periods;
  return (
    <>
      <PageHeader title="Profitability" right={<PeriodPicker />} />
      <div className="mb-6 grid gap-6 sm:grid-cols-3">
        <MoneyTile label="Gross profit" value={P.gross_profit} testId="tile-gp" />
        <MoneyTile label="Operating profit" value={P.operating_profit} />
        <MoneyTile label="EBIT" value={P.ebit} />
      </div>
      {b.ok ? (
        <div className="grid items-start gap-8 lg:grid-cols-[1.3fr_1fr]">
          <div data-testid="breakeven-chart"><BreakevenChart revenue={b.revenue} fixed={b.fixedCosts} vcr={b.vcr} bep={b.bep} cur={cur} /></div>
          <div className="space-y-5">
            <h3 className="text-2xl font-normal">Breakeven</h3>
            <Blk label={<><span className="text-green">●</span> Revenue</>} value={money(b.revenue, cur)}>
              <TopAccounts title="Top ten Revenue accounts" classes={["revenue"]} periods={periods} total={P.revenue} />
            </Blk>
            <Blk label={<><span className="text-red">●</span> Total costs</>} value={money(b.totalCosts, cur)}>
              <TopAccounts title="Top ten Expense and COS accounts" classes={["cos_variable", "cos_fixed", "cos_depreciation", "exp_variable", "exp_fixed", "exp_depreciation"]} periods={periods} total={b.totalCosts} />
            </Blk>
            <Blk label="● Breakeven point" value={money(b.bep, cur)} testId="bep" />
            <Blk label="Margin of safety" value={<span className={b.mos < 0 ? "text-red" : ""}>{money(b.mos, cur)} <span className="text-base text-mute">({b.mosPct.toFixed(0)}%)</span></span>} testId="mos" />
            <Blk label={<span className="text-red">— Variable costs</span>} value={<span className="text-base">{cur} {b.vcr.toFixed(2)} per {cur} 1 of Revenue</span>} />
            <Blk label="— Fixed costs" value={<span className="text-base">{money(b.fixedCosts, cur)}</span>} />
          </div>
        </div>
      ) : (
        <EmptyState title="Sorry, we can't load the Profitability tool"
          text={b.reason === "no_revenue" ? "A breakeven point cannot be calculated when there is no revenue." : "A breakeven point cannot be calculated when variable costs are equal to or greater than revenue."} />
      )}
      <Notes findings={a.findings.filter((f) => f.section === "profitability")} comment={c.commentary.profitability} />
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
