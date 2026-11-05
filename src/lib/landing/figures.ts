import { analyze } from "@/lib/engine";
import { valueCompany } from "@/lib/engine/valuation";
import { demoCompany } from "@/lib/company/demo";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { runChecks } from "@/lib/company/checks";
import { doctorFindings, healthScore } from "@/lib/doctor/findings";
import { valuationEnd, valuationInputs } from "@/lib/valuation/inputs";

/**
 * The figures on the landing page: real output of the engine on the demo company (made-up books), the same numbers
 * its demo pages show, never placeholders.
 */
export function landingFigures() {
  const c = demoCompany();
  const end = valuationEnd(c.months)!;
  const a = analyze(c.months, { type: "month", end }, c.settings);
  const s = a.view.series;
  const inputs = valuationInputs(c, null)!;
  const v = valueCompany(inputs, { purpose: "owner", sector: "medical" });
  const checks = runChecks({ accounts: c.accounts, months: c.months, unit: c.unit });
  const findings = doctorFindings({ checks, expenseFlags: demoExpenses().flags, months: c.months, basePath: c.basePath });
  const health = healthScore(findings, c.months);
  const last12 = <T,>(x: T[]) => x.slice(-12);
  return {
    company: c.name, end, currency: c.settings.currency,
    revenue: a.view.P.revenue,
    gpm: a.K.gpm ?? 0,
    cash: a.view.B?.cash ?? 0,
    kpiOnTrack: a.onTrack + a.offTrack > 0 ? a.onTrack / (a.onTrack + a.offTrack) : 0,
    kpis: a.onTrack + a.offTrack,
    series: { periods: last12(s.periods), revenue: last12(s.P.map((p) => p.revenue)), ebit: last12(s.P.map((p) => p.ebit)) },
    value: { fair: v.best.mid, low: v.best.low, high: v.best.high, highest: Math.max(v.best.high, v.ask.band?.high ?? 0) },
    doctor: { score: health.score, findings: health.open, atStake: health.atStake },
  };
}
export type LandingFigures = ReturnType<typeof landingFigures>;
