"use client";
import { money } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useComments, useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { CashWaterfall } from "@/components/charts/waterfall";
import { Legend, MoneyTile, NeedsOpening, Notes } from "./common";

export function CashflowPage() {
  const c = useCompany();
  const a = useAnalysis();
  const comments = useComments();
  if (!a) return null;
  const cur = c.settings.currency;
  const W = a.W;
  return (
    <>
      <PageHeader title="Cash Flow" right={<PeriodPicker />} />
      {!W ? <NeedsOpening /> : (
        <>
          <div className="mb-6 grid gap-6 sm:grid-cols-3">
            <MoneyTile label="Operating cash flow" value={W.ocf} testId="tile-ocf" />
            <MoneyTile label="Free cash flow" value={W.fcf} />
            <MoneyTile label="Net cash flow" value={W.ncf} testId="tile-ncf" />
          </div>
          <Legend items={[{ label: "Cash Received", color: "#2E9E6A" }, { label: "Cash Spent", color: "#D9343A" }]} />
          <CashWaterfall rows={W.rows} cur={cur} />
          <p className="mt-4 text-xs text-mute" data-testid="ncf-check">
            <b className="text-ink">NET CASH FLOW CAN ALSO BE CALCULATED AS:</b> Change in Cash on Hand {money(W.dcash, cur)} (Open: {money(W.cash0, cur)}, Close: {money(W.cash1, cur)}) − Change in Debt {money(W.ddebt, cur)} (Open: {money(W.debt0, cur)}, Close: {money(W.debt1, cur)})
          </p>
        </>
      )}
      <Notes findings={a.findings.filter((f) => f.section === "cashflow")} comment={comments("cashflow")} />
    </>
  );
}
