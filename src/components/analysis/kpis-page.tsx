"use client";
import { useMemo, useState } from "react";
import {
  analyze, CAT_COL, CAT_ORDER, explainKpi, formatTrend, kpiHistory, money, resolveTargets, type Comparison, type KpiRow,
} from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useComments, useAnalysis, usePeriod } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { SentenceSelect } from "@/components/ui/sentence-select";
import { Chip } from "@/components/ui/chips";
import { StatusIcon } from "@/components/ui/status";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { LineChart } from "@/components/charts/line-chart";
import { cn } from "@/lib/cn";
import { Notes } from "./common";
import { useT } from "@/lib/i18n/use-t";
import { explainKpiIn, kpiFormula } from "@/lib/i18n/kpis";

type Filter = "all" | "on" | "off" | "alerts";
const IMP_COL = { Critical: "text-red", High: "text-[#C26A1B]", Medium: "text-[#2a78d6]", Low: "text-mute" } as const;

export function KpisPage() {
  const c = useCompany();
  const a = useAnalysis();
  const comments = useComments();
  const { cmp, set } = usePeriod();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const T = useT();
  const t = T.d.ana;
  if (!a) return null;
  const cur = c.settings.currency;
  const rows = a.kpiRows;
  const alerts = rows.filter((r) => r.alert).length;
  const shown = rows.filter((r) => filter === "all" || (filter === "on" && r.ok === true) || (filter === "off" && r.ok === false) || (filter === "alerts" && r.alert));
  const cmpLabel = { target: t.targetUpper, prior: a.view.prior ? T.pl(a.view.prior.label) : t.priorUpper, ly: a.view.ly ? T.pl(a.view.ly.label) : t.lastYearUpper }[cmp];
  let letterI = 0;
  const openRow = rows.find((r) => r.def.key === open) ?? null;
  return (
    <>
      <PageHeader title={T.d.nav["analysis/kpis"][1]} right={<PeriodPicker />} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="sent">
          {t.showing} <b>{t.kpisN(rows.length)}</b> {t.comparingWith}{" "}
          <SentenceSelect<Comparison> testId="kpi-compare" value={cmp} onChange={(v) => set({ cmp: v })}
            options={[{ value: "target", label: t.cmpTarget }, { value: "prior", label: a.view.window.label === a.view.window.short && a.view.sel.type === "month" ? t.cmpLastMonth : t.cmpPrior }, { value: "ly", label: a.view.sel.type === "month" ? t.cmpSameMonthLY : t.cmpSamePeriodLY }]} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip count={rows.length} label={t.allKpis} active={filter === "all"} onClick={() => setFilter("all")} />
          <Chip count={a.onTrack} label={t.onTrack} tone="ok" active={filter === "on"} onClick={() => setFilter("on")} testId="chip-on" />
          <Chip count={a.offTrack} label={t.offTrack} tone="bad" active={filter === "off"} onClick={() => setFilter("off")} testId="chip-off" />
          <Chip count={alerts} label={t.alerts} tone="warn" active={filter === "alerts"} onClick={() => setFilter("alerts")} />
        </div>
      </div>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="tbl" data-testid="kpi-table">
          <thead>
            <tr><th></th><th>{t.result}</th><th className="hidden sm:table-cell">{cmp === "target" ? t.targetWord : t.compared}</th><th></th><th>{t.trend}</th><th className="hidden md:table-cell">{t.importance}</th></tr>
          </thead>
          <tbody>
            {CAT_ORDER.map((cat) => {
              const list = shown.filter((r) => r.def.category === cat);
              if (!rows.some((r) => r.def.category === cat)) return null;
              const L = "ABCDEFGHIJ"[letterI++];
              if (!list.length) return null;
              return [
                <tr key={cat} className="cat">
                  <td><span className="me-2 inline-block h-[18px] w-[18px] rounded-sm text-center text-[11px] leading-[18px] text-white" style={{ background: CAT_COL[cat] }}>{L}</span>{T.tl(cat)}</td>
                  <td>{cat === CAT_ORDER[0] ? T.pl(a.view.window.short) : ""}</td><td className="hidden sm:table-cell" /><td /><td className="text-[10px]">{cat === CAT_ORDER[0] ? t.vs(cmpLabel) : ""}</td><td className="hidden md:table-cell" />
                </tr>,
                ...list.map((r) => <KpiTr key={r.def.key} r={r} cur={cur} onOpen={() => setOpen(r.def.key)} />),
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-mute">{t.kpiFoot}</p>
      <Notes findings={a.findings.filter((f) => f.section === "kpis")} comment={comments("kpis")} />
      <Dialog open={!!openRow} onOpenChange={(o) => !o && setOpen(null)}>
        {openRow && <KpiModal row={openRow} />}
      </Dialog>
    </>
  );
}

function KpiTr({ r, cur, onOpen }: { r: KpiRow; cur: string; onOpen: () => void }) {
  const T = useT();
  const fav = r.ok;
  return (
    <tr className="row cursor-pointer" onClick={onOpen} data-testid={`kpi-${r.def.key}`}>
      <td>
        {r.alert && <span className="me-2 inline-block h-[7px] w-[7px] rounded-full bg-red align-middle" title={T.d.ana.alert} />}
        <button className="text-start hover:underline">{T.kn(r.def)}{r.def.direction === "down" ? "*" : ""}</button>
      </td>
      <td>{T.num(r.value, r.def.unit, cur)}</td>
      <td className="hidden text-mute sm:table-cell">{r.compare === null ? "–" : T.num(r.compare, r.def.unit, cur)}</td>
      <td className="text-center"><StatusIcon ok={r.ok} /></td>
      <td>{r.trend ? <><span className={fav === null ? "text-mute" : r.trend.value === 0 ? "text-mute" : ((r.trend.value > 0) === (r.def.direction === "up")) ? "text-green-d" : "text-red"}>{r.trend.value > 0 ? "▲" : "▼"}</span> {T.lang === "ar" ? formatTrend(r.trend, cur).replace(/ days$/, " يوم").replace(/ times$/, " مرة") : formatTrend(r.trend, cur)}</> : "–"}</td>
      <td className={`hidden md:table-cell ${IMP_COL[r.importance]}`}>{T.tl(r.importance)}</td>
    </tr>
  );
}

function KpiModal({ row }: { row: KpiRow }) {
  const c = useCompany();
  const a = useAnalysis()!;
  const T = useT();
  const t = T.d.ana;
  const cur = c.settings.currency;
  const hist = useMemo(() => kpiHistory(c.months, c.settings, a.view.window.end, 13), [c.months, c.settings, a.view.window.end]);
  const last12 = hist.slice(-12);
  const tgt = a.targets[row.def.key] ?? null;
  // The chart shows monthly values, so it is drawn against the monthly target.
  const monthTgt = resolveTargets(c.settings)[row.def.key] ?? null;
  const vals = last12.map((h) => h.K[row.def.key]);
  const marks = vals.map((v) => (v === null || monthTgt === null ? null : row.def.direction === "up" ? v >= monthTgt : v <= monthTgt));
  // Same-length comparisons: the prior month, quarter or year, and the same period a year earlier.
  const cmp = useMemo(() => {
    const at = (comparison: "prior" | "ly") => analyze(c.months, a.view.sel, c.settings, { comparison }).kpiRows.find((r) => r.def.key === row.def.key)?.compare ?? null;
    return { prev: at("prior"), ly: at("ly") };
  }, [c.months, c.settings, a.view.sel, row.def.key]);
  const prev = cmp.prev, ly = cmp.ly;
  const nums = vals.filter((v): v is number => v !== null);
  const avg = nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
  const fmt = (v: number | null) => T.num(v, row.def.unit, cur);
  const name = T.kn(row.def);
  const diff = (x: number | null, y: number | null) => (x === null || y === null ? "–" : row.def.unit === "cur" ? (y ? `${(((x - y) / Math.abs(y)) * 100).toFixed(1)}%` : "–") : T.num(x - y, row.def.unit === "%" ? "num" : row.def.unit, cur) + (row.def.unit === "%" ? t.pp : ""));
  return (
    <DialogContent title={name}>
      <div className="grid md:grid-cols-[1fr_280px]">
        <div className="p-6">
          <div className="mb-3 flex items-center gap-3 pe-8"><StatusIcon ok={row.ok} size="lg" /><h2 className="text-2xl font-normal">{name}</h2></div>
          <p className="mb-3 text-[13.5px] leading-relaxed">{explainKpiIn(row.def, row.value, tgt, cur, T.lang, explainKpi(row.def, row.value, tgt, cur))}</p>
          <p className="mb-4 rounded bg-band px-3 py-2 font-mono text-xs">{kpiFormula(row.def, T.lang)}</p>
          <LineChart labels={last12.map((h) => T.ms(h.period))} unit={row.def.unit === "ratio" ? "num" : row.def.unit} cur={cur} target={monthTgt} marks={marks} height={260}
            series={[{ name, values: vals, color: "#2a78d6", fill: true }]} />
        </div>
        <div className="space-y-4 bg-band p-6 text-sm">
          {[
            [T.pl(a.view.window.label), fmt(row.value)],
            [t.targetWord, tgt === null ? "– –" : row.def.unit === "cur" ? money(tgt, cur) : fmt(tgt)],
            [t.changeFrom(a.view.prior ? T.pl(a.view.prior.label) : t.priorWord[a.view.sel.type]), diff(row.value, prev)],
            [t.changeFrom(a.view.ly ? T.pl(a.view.ly.label) : t.yearEarlier), diff(row.value, ly)],
            [t.avg12(last12[0] ? T.ml(last12[0].period) : "–"), fmt(avg)],
            [t.kpiImportance, T.tl(row.importance)],
          ].map(([l, v]) => (
            <div key={l}><div className="label">{l}</div><div className={cn("num text-xl", l === T.pl(a.view.window.label) && (row.ok === false ? "text-red" : row.ok ? "text-green-d" : ""))}>{v}</div></div>
          ))}
        </div>
      </div>
    </DialogContent>
  );
}
