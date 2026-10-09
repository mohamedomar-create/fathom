import { breakeven } from "./breakeven";
import { cashFlowStatement, cashWaterfall } from "./cashflow";
import { insights, type Finding } from "./insights";
import { computeKpis, KPI_DEFS, kpiStatus, type KpiDef, type KpiTrend } from "./kpis";
import { periodView, type PeriodSel, type PeriodView } from "./period";
import type { CompanySettings, Comparison, Importance, MonthData } from "./types";

export interface KpiRow {
  def: KpiDef;
  value: number | null;
  compare: number | null;
  ok: boolean | null;
  trend: KpiTrend | null;
  importance: Importance;
  alert: boolean;
}

export interface Analysis {
  view: PeriodView;
  settings: CompanySettings;
  W: ReturnType<typeof cashWaterfall> | null;
  CF: ReturnType<typeof cashFlowStatement> | null;
  K: Record<string, number | null>;
  targets: Record<string, number | null>;
  kpiRows: KpiRow[];
  onTrack: number;
  offTrack: number;
  findings: Finding[];
  breakeven: ReturnType<typeof breakeven>;
}

export function resolveTargets(settings: CompanySettings): Record<string, number | null> {
  return Object.fromEntries(KPI_DEFS.map((d) => {
    const t = settings.targets?.[d.key];
    return [d.key, t === undefined ? d.target : t];
  }));
}

export function activeKpiDefs(settings: CompanySettings): KpiDef[] {
  const act = settings.activeKpis;
  return KPI_DEFS.filter((d) => (act ? act.includes(d.key) : d.defaultActive));
}

const PRIOR_LABEL = { month: "last month", quarter: "the prior quarter", year: "the prior year" } as const;

export function analyze(
  months: MonthData[], sel: PeriodSel, settings: CompanySettings,
  opts: { comparison?: Comparison; alerts?: Record<string, { active: boolean; threshold: number | null }> } = {},
): Analysis {
  const view = periodView(months, sel, settings.fyStartMonth);
  const { P, B, B0 } = view;
  const t = settings.taxRate;
  const W = B0 ? cashWaterfall(P, B, B0, t) : null;
  const CF = B0 ? cashFlowStatement(P, B, B0) : null;
  const K = computeKpis({ P, B, B0, Pprev: view.prior?.P ?? null, days: view.days, ocf: W?.ocf ?? null });
  const targets = resolveTargets(settings);
  const comparison = opts.comparison ?? "target";
  let compareK: Record<string, number | null> | null = null;
  if (comparison !== "target") {
    const c = comparison === "prior" ? view.prior : view.ly;
    if (c) {
      const sel2 = { type: sel.type, end: c.label ? shiftEnd(sel.end, comparison === "prior" ? sel.type : "year") : sel.end };
      try {
        const v2 = periodView(months, sel2, settings.fyStartMonth);
        const W2 = v2.B0 ? cashWaterfall(v2.P, v2.B, v2.B0, t) : null;
        compareK = computeKpis({ P: v2.P, B: v2.B, B0: v2.B0, Pprev: v2.prior?.P ?? null, days: v2.days, ocf: W2?.ocf ?? null });
      } catch { compareK = null; }
    }
  }
  // Status always vs target (drives on/off track); trend column vs the chosen comparison.
  const status: Record<string, boolean | null> = {};
  const kpiRows: KpiRow[] = [];
  let onTrack = 0, offTrack = 0;
  const active = new Set(activeKpiDefs(settings).map((d) => d.key));
  for (const def of KPI_DEFS) {
    const value = K[def.key] ?? null;
    const tgt = targets[def.key];
    const st = kpiStatus(value, tgt, def.direction, def.unit);
    status[def.key] = st.ok;
    if (!active.has(def.key)) continue;
    const compare = comparison === "target" ? tgt : compareK?.[def.key] ?? null;
    const cmp = comparison === "target" ? st : kpiStatus(value, compare, def.direction, def.unit);
    if (st.ok === true) onTrack++;
    else if (st.ok === false) offTrack++;
    const al = opts.alerts?.[def.key];
    const alert = Boolean(al?.active && al.threshold !== null && value !== null && (def.direction === "up" ? value < al.threshold : value > al.threshold));
    kpiRows.push({ def, value, compare, ok: st.ok, trend: cmp.trend, importance: settings.importance?.[def.key] ?? def.importance, alert });
  }
  const findings = insights({
    P, B, Pprev: view.prior?.P ?? null, K, W, tg: targets, Ps: view.series.P, Bs: view.series.B, days: view.days, status,
    cur: settings.currency, priorLabel: PRIOR_LABEL[sel.type],
  });
  return { view, settings, W, CF, K, targets, kpiRows, onTrack, offTrack, findings, breakeven: breakeven(P) };
}

function shiftEnd(end: string, type: "month" | "quarter" | "year") {
  const [y, m] = end.split("-").map(Number);
  const back = type === "month" ? 1 : type === "quarter" ? 3 : 12;
  const i = y * 12 + m - 1 - back;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** Monthly KPI values for the n months ending at `end` (used for KPI detail charts and rolling averages). */
export function kpiHistory(months: MonthData[], settings: CompanySettings, end: string, n = 12): { period: string; K: Record<string, number | null> }[] {
  const ps = [...months].map((m) => m.period).sort().filter((p) => p <= end).slice(-n);
  return ps.map((p) => {
    const v = periodView(months, { type: "month", end: p }, settings.fyStartMonth);
    const W = v.B0 ? cashWaterfall(v.P, v.B, v.B0, settings.taxRate) : null;
    return { period: p, K: computeKpis({ P: v.P, B: v.B, B0: v.B0, Pprev: v.prior?.P ?? null, days: v.days, ocf: W?.ocf ?? null }) };
  });
}
