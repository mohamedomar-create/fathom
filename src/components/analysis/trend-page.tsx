"use client";
import { ChevronRight, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { mshort, num } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SentenceSelect } from "@/components/ui/sentence-select";
import { LineChart } from "@/components/charts/line-chart";
import { C } from "@/components/charts/util";
import { cn } from "@/lib/cn";
import { metricCatalogue, metricValue, monthCalcs, PREDEFINED, type MetricDef } from "./metrics";
import { Notes } from "./common";

export function TrendPage() {
  const c = useCompany();
  const a = useAnalysis();
  const [keys, setKeys] = useState<string[]>(["p:revenue"]);
  const [year, setYear] = useState<string>("All");
  const [note, setNote] = useState<string | null>(null);
  const calcs = useMemo(() => monthCalcs(c.months, c.settings.taxRate), [c.months, c.settings.taxRate]);
  const cat = useMemo(() => metricCatalogue(c.accounts), [c.accounts]);
  if (!a) return null;
  const end = a.view.window.end;
  const upto = calcs.filter((m) => m.period <= end);
  const years = [...new Set(upto.map((m) => m.period.slice(0, 4)))];
  const rows = year === "All" ? upto : upto.filter((m) => m.period.startsWith(year));
  const defs = keys.map((k) => cat.find((m) => m.key === k)!).filter(Boolean);
  const unit = defs[0]?.unit ?? "cur";
  const add = (m: MetricDef) => {
    if (keys.includes(m.key)) return;
    if (defs.length && m.unit !== unit) { setKeys([m.key]); setNote(`${m.label} uses a different unit, so it is shown on its own (one axis per chart).`); return; }
    setNote(null);
    setKeys((k) => [...k, m.key].slice(-5));
  };
  const series = defs.map((d, i) => ({ name: d.label, values: rows.map((m) => metricValue(d.key, m, c.accounts)), color: C.s[i % 5], fill: defs.length === 1 }));
  const cur = c.settings.currency;
  return (
    <>
      <PageHeader title="Trend" right={<PeriodPicker mode="upto" allowTypes={false} />}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="sent">Showing</span>
          {defs.map((d, i) => (
            <span key={d.key} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white py-0.5 pl-2.5 pr-1 text-[13px]">
              <i className="h-2 w-2 rounded-full" style={{ background: C.s[i % 5] }} />{d.label}
              {defs.length > 1 && <button aria-label={`Remove ${d.label}`} onClick={() => setKeys(keys.filter((k) => k !== d.key))} className="rounded-full p-0.5 hover:bg-band"><X className="h-3 w-3" /></button>}
            </span>
          ))}
          <MetricPicker catalogue={cat} onPick={add} />
          <span className="sent ml-2">or</span>
          <SentenceSelect value={"__"} onChange={(v) => { const p = PREDEFINED.find((x) => x.label === v); if (p) { setKeys(p.keys); setNote(null); } }}
            options={[{ value: "__", label: "Select a predefined chart" }, ...PREDEFINED.map((p) => ({ value: p.label, label: p.label }))]} />
        </div>
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-1 text-sm">
        <span className="mr-1 text-mute">Show:</span>
        {[...years, "All"].map((y) => (
          <button key={y} onClick={() => setYear(y)} className={cn("rounded px-2.5 py-0.5", y === year ? "bg-green-bg font-semibold text-green-d" : "hover:bg-band")}>{y}</button>
        ))}
      </div>
      {note && <p className="mb-2 text-xs text-[#9a6b00]">{note}</p>}
      <div data-testid="trend-chart"><LineChart labels={rows.map((m) => mshort(m.period))} series={series} unit={unit} cur={cur} height={340} /></div>
      <div className="-mx-4 mt-6 overflow-x-auto px-4">
        <table className="tbl text-[12.5px]">
          <thead><tr><th>Metric</th>{rows.map((m) => <th key={m.period}>{mshort(m.period)}</th>)}</tr></thead>
          <tbody>
            {defs.map((d) => (
              <tr key={d.key} className="row"><td className="min-w-48">{d.label}</td>{rows.map((m) => <td key={m.period}>{num(metricValue(d.key, m, c.accounts), d.unit === "cur" ? "num" : d.unit, cur).replace(/\.\d\d$/, "")}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notes findings={a.findings.filter((f) => f.section === "trend")} comment={c.commentary.trend} />
    </>
  );
}

function MetricPicker({ catalogue, onPick }: { catalogue: MetricDef[]; onPick: (m: MetricDef) => void }) {
  const [q, setQ] = useState("");
  const [openG, setOpenG] = useState<string | null>("Profit & Loss");
  const groups = ["KPIs", "Profit & Loss", "Balance Sheet", "Cash Flow", "Chart of Accounts"] as const;
  const match = (m: MetricDef) => m.label.toLowerCase().includes(q.toLowerCase());
  return (
    <Popover>
      <PopoverTrigger className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-green text-green-d hover:bg-green-bg" aria-label="Add a metric" data-testid="add-metric"><Plus className="h-4 w-4" /></PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2"><Search className="h-4 w-4 text-mute" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a metric" className="w-full text-sm outline-none" />
        </div>
        <div className="max-h-80 overflow-auto p-1">
          {groups.map((g) => {
            const items = catalogue.filter((m) => m.group === g && match(m));
            if (!items.length) return null;
            const open = q !== "" || openG === g;
            return (
              <div key={g}>
                <button onClick={() => setOpenG(open && !q ? null : g)} className="flex w-full items-center gap-1 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-mute">
                  <ChevronRight className={cn("h-3.5 w-3.5 transition", open && "rotate-90")} />{g} <span className="font-normal">({items.length})</span>
                </button>
                {open && items.map((m) => (
                  <button key={m.key} onClick={() => onPick(m)} className="block w-full rounded px-7 py-1 text-left text-sm hover:bg-band">{m.label}</button>
                ))}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
