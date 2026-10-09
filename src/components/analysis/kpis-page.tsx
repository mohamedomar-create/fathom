"use client";
import { useMemo, useState } from "react";
import {
  CAT_COL, CAT_ORDER, explainKpi, formatTrend, kpiHistory, mlabel, money, mshort, num, type Comparison, type KpiRow,
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

type Filter = "all" | "on" | "off" | "alerts";
const IMP_COL = { Critical: "text-red", High: "text-[#C26A1B]", Medium: "text-[#2a78d6]", Low: "text-mute" } as const;

export function KpisPage() {
  const c = useCompany();
  const a = useAnalysis();
  const comments = useComments();
  const { cmp, set } = usePeriod();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  if (!a) return null;
  const cur = c.settings.currency;
  const rows = a.kpiRows;
  const alerts = rows.filter((r) => r.alert).length;
  const shown = rows.filter((r) => filter === "all" || (filter === "on" && r.ok === true) || (filter === "off" && r.ok === false) || (filter === "alerts" && r.alert));
  const cmpLabel = { target: "TARGET", prior: a.view.prior?.label ?? "PRIOR", ly: a.view.ly?.label ?? "LAST YEAR" }[cmp];
  let letterI = 0;
  const openRow = rows.find((r) => r.def.key === open) ?? null;
  return (
    <>
      <PageHeader title="KPIs" right={<PeriodPicker />} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="sent">
          Showing <b>{rows.length} KPIs</b> comparing with{" "}
          <SentenceSelect<Comparison> testId="kpi-compare" value={cmp} onChange={(v) => set({ cmp: v })}
            options={[{ value: "target", label: "Target" }, { value: "prior", label: a.view.window.label === a.view.window.short && a.view.sel.type === "month" ? "Last month" : "Prior period" }, { value: "ly", label: a.view.sel.type === "month" ? "Same month LY" : "Same period LY" }]} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip count={rows.length} label="All KPIs" active={filter === "all"} onClick={() => setFilter("all")} />
          <Chip count={a.onTrack} label="On track" tone="ok" active={filter === "on"} onClick={() => setFilter("on")} testId="chip-on" />
          <Chip count={a.offTrack} label="Off track" tone="bad" active={filter === "off"} onClick={() => setFilter("off")} testId="chip-off" />
          <Chip count={alerts} label="Alerts" tone="warn" active={filter === "alerts"} onClick={() => setFilter("alerts")} />
        </div>
      </div>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="tbl" data-testid="kpi-table">
          <thead>
            <tr><th></th><th>Result</th><th className="hidden sm:table-cell">{cmp === "target" ? "Target" : "Compared"}</th><th></th><th>Trend</th><th className="hidden md:table-cell">Importance</th></tr>
          </thead>
          <tbody>
            {CAT_ORDER.map((cat) => {
              const list = shown.filter((r) => r.def.category === cat);
              if (!rows.some((r) => r.def.category === cat)) return null;
              const L = "ABCDEFGHIJ"[letterI++];
              if (!list.length) return null;
              return [
                <tr key={cat} className="cat">
                  <td><span className="mr-2 inline-block h-[18px] w-[18px] rounded-sm text-center text-[11px] leading-[18px] text-white" style={{ background: CAT_COL[cat] }}>{L}</span>{cat}</td>
                  <td>{cat === CAT_ORDER[0] ? a.view.window.short : ""}</td><td className="hidden sm:table-cell" /><td /><td className="text-[10px]">{cat === CAT_ORDER[0] ? `vs ${cmpLabel}` : ""}</td><td className="hidden md:table-cell" />
                </tr>,
                ...list.map((r) => <KpiTr key={r.def.key} r={r} cur={cur} onOpen={() => setOpen(r.def.key)} />),
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-mute">* For this metric, a result below target is favourable. A red dot means an alert threshold has been crossed. Trend for currency KPIs is % vs the comparison; for % KPIs it is percentage points.</p>
      <Notes findings={a.findings.filter((f) => f.section === "kpis")} comment={comments("kpis")} />
      <Dialog open={!!openRow} onOpenChange={(o) => !o && setOpen(null)}>
        {openRow && <KpiModal row={openRow} />}
      </Dialog>
    </>
  );
}

function KpiTr({ r, cur, onOpen }: { r: KpiRow; cur: string; onOpen: () => void }) {
  const fav = r.ok;
  return (
    <tr className="row cursor-pointer" onClick={onOpen} data-testid={`kpi-${r.def.key}`}>
      <td>
        {r.alert && <span className="mr-2 inline-block h-[7px] w-[7px] rounded-full bg-red align-middle" title="Alert" />}
        <button className="text-left hover:underline">{r.def.name}{r.def.direction === "down" ? "*" : ""}</button>
      </td>
      <td>{num(r.value, r.def.unit, cur)}</td>
      <td className="hidden text-mute sm:table-cell">{r.compare === null ? "–" : num(r.compare, r.def.unit, cur)}</td>
      <td className="text-center"><StatusIcon ok={r.ok} /></td>
      <td>{r.trend ? <><span className={fav === null ? "text-mute" : r.trend.value === 0 ? "text-mute" : ((r.trend.value > 0) === (r.def.direction === "up")) ? "text-green-d" : "text-red"}>{r.trend.value > 0 ? "▲" : "▼"}</span> {formatTrend(r.trend, cur)}</> : "–"}</td>
      <td className={`hidden md:table-cell ${IMP_COL[r.importance]}`}>{r.importance}</td>
    </tr>
  );
}

function KpiModal({ row }: { row: KpiRow }) {
  const c = useCompany();
  const a = useAnalysis()!;
  const cur = c.settings.currency;
  const hist = useMemo(() => kpiHistory(c.months, c.settings, a.view.window.end, 13), [c.months, c.settings, a.view.window.end]);
  const last12 = hist.slice(-12);
  const tgt = a.targets[row.def.key] ?? null;
  const vals = last12.map((h) => h.K[row.def.key]);
  const marks = vals.map((v) => (v === null || tgt === null ? null : row.def.direction === "up" ? v >= tgt : v <= tgt));
  const prev = hist.length > 1 ? hist[hist.length - 2].K[row.def.key] : null;
  const lyp = `${Number(a.view.window.end.slice(0, 4)) - 1}${a.view.window.end.slice(4)}`;
  const ly = (() => { try { return kpiHistory(c.months, c.settings, lyp, 1).find((h) => h.period === lyp)?.K[row.def.key] ?? null; } catch { return null; } })();
  const nums = vals.filter((v): v is number => v !== null);
  const avg = nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
  const fmt = (v: number | null) => num(v, row.def.unit, cur);
  const diff = (x: number | null, y: number | null) => (x === null || y === null ? "–" : row.def.unit === "cur" ? (y ? `${(((x - y) / Math.abs(y)) * 100).toFixed(1)}%` : "–") : num(x - y, row.def.unit === "%" ? "num" : row.def.unit, cur) + (row.def.unit === "%" ? " pp" : ""));
  return (
    <DialogContent title={row.def.name}>
      <div className="grid md:grid-cols-[1fr_280px]">
        <div className="p-6">
          <div className="mb-3 flex items-center gap-3 pr-8"><StatusIcon ok={row.ok} size="lg" /><h2 className="text-2xl font-normal">{row.def.name}</h2></div>
          <p className="mb-3 text-[13.5px] leading-relaxed">{explainKpi(row.def, row.value, tgt, cur)}</p>
          <p className="mb-4 rounded bg-band px-3 py-2 font-mono text-xs">{row.def.formula}</p>
          <LineChart labels={last12.map((h) => mshort(h.period))} unit={row.def.unit === "ratio" ? "num" : row.def.unit} cur={cur} target={tgt} marks={marks} height={260}
            series={[{ name: row.def.name, values: vals, color: "#2a78d6", fill: true }]} />
        </div>
        <div className="space-y-4 bg-band p-6 text-sm">
          {[
            [a.view.window.label, fmt(row.value)],
            ["Target", tgt === null ? "– –" : row.def.unit === "cur" ? money(tgt, cur) : fmt(tgt)],
            ["Change from prior month", diff(row.value, prev)],
            [`Change from ${mlabel(lyp)}`, diff(row.value, ly)],
            [`Rolling avg (12 month starting ${last12[0] ? mlabel(last12[0].period) : "–"})`, fmt(avg)],
            ["KPI importance", row.importance],
          ].map(([l, v]) => (
            <div key={l}><div className="label">{l}</div><div className={cn("num text-xl", l === a.view.window.label && (row.ok === false ? "text-red" : row.ok ? "text-green-d" : ""))}>{v}</div></div>
          ))}
        </div>
      </div>
    </DialogContent>
  );
}
