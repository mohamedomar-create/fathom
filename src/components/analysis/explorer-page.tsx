"use client";
import { useState } from "react";
import { CAT_ORDER, num } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { Chip } from "@/components/ui/chips";
import { SentenceSelect } from "@/components/ui/sentence-select";
import { KpiArc, type ArcItem } from "@/components/charts/kpi-arc";

export function ExplorerPage() {
  const c = useCompany();
  const a = useAnalysis();
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const [group, setGroup] = useState<"perspective" | "status">("perspective");
  if (!a) return null;
  const cur = c.settings.currency;
  let items: ArcItem[] = a.kpiRows.filter((r) => r.ok !== null).map((r) => ({
    key: r.def.key, category: r.def.category, name: r.def.name, ok: r.ok!,
    detail: `${num(r.value, r.def.unit, cur)} vs target ${num(r.compare, r.def.unit, cur)}`,
  }));
  items.sort((x, y) => group === "perspective" ? CAT_ORDER.indexOf(x.category) - CAT_ORDER.indexOf(y.category) : Number(y.ok) - Number(x.ok) || CAT_ORDER.indexOf(x.category) - CAT_ORDER.indexOf(y.category));
  if (filter !== "all") items = items.filter((i) => i.ok === (filter === "on"));
  const pctOn = a.onTrack + a.offTrack ? (a.onTrack / (a.onTrack + a.offTrack)) * 100 : 0;
  const na = a.kpiRows.length - a.onTrack - a.offTrack;
  return (
    <>
      <PageHeader title="KPI Explorer" right={<PeriodPicker />} />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="sent">Showing <b>{a.kpiRows.length} KPIs</b> grouped by{" "}
          <SentenceSelect value={group} onChange={setGroup} options={[{ value: "perspective", label: "Perspective" }, { value: "status", label: "Status" }]} />
        </div>
        <div className="flex gap-2">
          <Chip count={a.kpiRows.length - na} label="All KPIs" active={filter === "all"} onClick={() => setFilter("all")} />
          <Chip count={a.onTrack} label="On track" tone="ok" active={filter === "on"} onClick={() => setFilter("on")} />
          <Chip count={a.offTrack} label="Off track" tone="bad" active={filter === "off"} onClick={() => setFilter("off")} />
        </div>
      </div>
      <div className="mx-auto max-w-5xl" data-testid="kpi-arc">
        <KpiArc items={items} pctOn={pctOn} period={a.view.window.short} />
      </div>
      <p className="text-center text-xs text-mute">
        {a.kpiRows.length} KPIs ({na} n/a results) · <span className="text-green-d">{a.onTrack} ON TRACK</span> · <span className="text-red">{a.offTrack} OFF TRACK</span>
      </p>
    </>
  );
}
