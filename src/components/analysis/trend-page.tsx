"use client";
import { ChevronRight, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { num } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useComments, useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SentenceSelect } from "@/components/ui/sentence-select";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import { cn } from "@/lib/cn";
import { metricCatalogue, metricValue, monthCalcs, PREDEFINED, type MetricDef } from "./metrics";
import { Notes } from "./common";
import { useT } from "@/lib/i18n/use-t";
import { KPI_AR } from "@/lib/i18n/kpis";

/** A metric's name in the chosen language: KPIs by key, statement lines by name, accounts as the company wrote them. */
function useMetricLabel() {
  const T = useT();
  return (m: MetricDef) => (T.lang !== "ar" || m.key.startsWith("a:") ? m.label : m.key.startsWith("k:") ? KPI_AR[m.key.slice(2)]?.[0] ?? m.label : T.tl(m.label));
}

export function TrendPage() {
  const c = useCompany();
  const a = useAnalysis();
  const comments = useComments();
  const [keys, setKeys] = useState<string[]>(["p:revenue"]);
  const [year, setYear] = useState<string>("All");
  const [note, setNote] = useState<string | null>(null);
  const calcs = useMemo(() => monthCalcs(c.months), [c.months]);
  const cat = useMemo(() => metricCatalogue(c.accounts), [c.accounts]);
  const T = useT();
  const t = T.d.ana;
  const lab = useMetricLabel();
  if (!a) return null;
  const end = a.view.window.end;
  const upto = calcs.filter((m) => m.period <= end);
  const years = [...new Set(upto.map((m) => m.period.slice(0, 4)))];
  const rows = year === "All" ? upto : upto.filter((m) => m.period.startsWith(year));
  const defs = keys.map((k) => cat.find((m) => m.key === k)!).filter(Boolean);
  const unit = defs[0]?.unit ?? "cur";
  const add = (m: MetricDef) => {
    if (keys.includes(m.key)) return;
    if (defs.length && m.unit !== unit) { setKeys([m.key]); setNote(t.otherUnit(lab(m))); return; }
    setNote(null);
    setKeys((k) => [...k, m.key].slice(-5));
  };
  const series = defs.map((d, i) => ({ name: lab(d), values: rows.map((m) => metricValue(d.key, m, c.accounts)), color: C.s[i % 5], fill: defs.length === 1 }));
  const cur = c.settings.currency;
  return (
    <>
      <PageHeader title={T.d.nav["analysis/trend"][1]} right={<PeriodPicker mode="upto" allowTypes={false} />}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="sent">{t.showing}</span>
          {defs.map((d, i) => (
            <span key={d.key} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-0.5 ps-2.5 pe-1 text-[13px]">
              <i className="h-2 w-2 rounded-full" style={{ background: C.s[i % 5] }} />{lab(d)}
              {defs.length > 1 && <button aria-label={t.remove(lab(d))} onClick={() => setKeys(keys.filter((k) => k !== d.key))} className="rounded-full p-0.5 hover:bg-band"><X className="h-3 w-3" /></button>}
            </span>
          ))}
          <MetricPicker catalogue={cat} onPick={add} />
          <span className="sent ms-2">{t.or}</span>
          <SentenceSelect value={"__"} onChange={(v) => { const p = PREDEFINED.find((x) => x.label === v); if (p) { setKeys(p.keys); setNote(null); } }}
            options={[{ value: "__", label: t.predefined }, ...PREDEFINED.map((p) => ({ value: p.label, label: T.tl(p.label) }))]} />
        </div>
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
        <span className="me-1 text-mute">{t.show}</span>
        {[...years, "All"].map((y) => (
          <button key={y} onClick={() => setYear(y)} className={cn("rounded px-2.5 py-0.5", y === year ? "bg-brand-bg font-semibold text-brand-d" : "hover:bg-band")}>{y === "All" ? t.all : y}</button>
        ))}
      </div>
      {note && <p className="mb-2 text-xs text-[#9a6b00]">{note}</p>}
      <div data-testid="trend-chart"><LineChart labels={rows.map((m) => T.ms(m.period))} series={series} unit={unit} cur={cur} height={340} /></div>
      <div className="-mx-4 mt-6 overflow-x-auto px-4">
        <table className="tbl text-[12.5px]">
          <thead><tr><th>{t.metric}</th>{rows.map((m) => <th key={m.period}>{T.ms(m.period)}</th>)}</tr></thead>
          <tbody>
            {defs.map((d) => (
              <tr key={d.key} className="row"><td className="min-w-48">{lab(d)}</td>{rows.map((m) => <td key={m.period}>{num(metricValue(d.key, m, c.accounts), d.unit === "cur" ? "num" : d.unit, cur).replace(/\.\d\d$/, "")}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notes findings={a.findings.filter((f) => f.section === "trend")} comment={comments("trend")} />
    </>
  );
}

function MetricPicker({ catalogue, onPick }: { catalogue: MetricDef[]; onPick: (m: MetricDef) => void }) {
  const [q, setQ] = useState("");
  const [openG, setOpenG] = useState<string | null>("Profit & Loss");
  const T = useT();
  const lab = useMetricLabel();
  const groups = ["KPIs", "Profit & Loss", "Balance Sheet", "Cash Flow", "Chart of Accounts"] as const;
  const match = (m: MetricDef) => m.label.toLowerCase().includes(q.toLowerCase()) || lab(m).includes(q);
  return (
    <Popover>
      <PopoverTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-brand text-brand-d hover:bg-brand-bg" aria-label={T.d.ana.addMetric} data-testid="add-metric"><Plus className="h-4 w-4" /></PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2"><Search className="h-4 w-4 text-mute" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.d.ana.searchMetric} className="w-full text-sm outline-none" />
        </div>
        <div className="max-h-80 overflow-auto p-1">
          {groups.map((g) => {
            const items = catalogue.filter((m) => m.group === g && match(m));
            if (!items.length) return null;
            const open = q !== "" || openG === g;
            return (
              <div key={g}>
                <button onClick={() => setOpenG(open && !q ? null : g)} className="flex w-full items-center gap-1 px-2 py-1.5 text-start text-xs font-semibold uppercase tracking-wide text-mute">
                  <ChevronRight className={cn("flip-rtl h-3.5 w-3.5 transition", open && "rotate-90")} />{T.tl(g)} <span className="font-normal">({items.length})</span>
                </button>
                {open && items.map((m) => (
                  <button key={m.key} onClick={() => onPick(m)} className="block w-full rounded px-7 py-1 text-start text-sm hover:bg-band">{lab(m)}</button>
                ))}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
