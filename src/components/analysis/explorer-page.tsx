"use client";
import { useState } from "react";
import { CAT_ORDER } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { Chip } from "@/components/ui/chips";
import { SentenceSelect } from "@/components/ui/sentence-select";
import { KpiArc, type ArcItem } from "@/components/charts/kpi-arc";
import { useT } from "@/lib/i18n/use-t";

export function ExplorerPage() {
  const c = useCompany();
  const a = useAnalysis();
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const [group, setGroup] = useState<"perspective" | "status">("perspective");
  const T = useT();
  const t = T.d.ana;
  if (!a) return null;
  const cur = c.settings.currency;
  let items: ArcItem[] = a.kpiRows.filter((r) => r.ok !== null).map((r) => ({
    key: r.def.key, category: r.def.category, name: T.kn(r.def), ok: r.ok!,
    detail: t.vsTarget(T.num(r.value, r.def.unit, cur), T.num(r.compare, r.def.unit, cur)),
  }));
  items.sort((x, y) => group === "perspective" ? CAT_ORDER.indexOf(x.category) - CAT_ORDER.indexOf(y.category) : Number(y.ok) - Number(x.ok) || CAT_ORDER.indexOf(x.category) - CAT_ORDER.indexOf(y.category));
  if (filter !== "all") items = items.filter((i) => i.ok === (filter === "on"));
  const pctOn = a.onTrack + a.offTrack ? (a.onTrack / (a.onTrack + a.offTrack)) * 100 : 0;
  const na = a.kpiRows.length - a.onTrack - a.offTrack;
  return (
    <>
      <PageHeader title={T.d.nav["analysis/explorer"][1]} right={<PeriodPicker />} />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="sent">{t.showing} <b>{t.kpisN(a.kpiRows.length)}</b> {t.groupedBy}{" "}
          <SentenceSelect value={group} onChange={setGroup} options={[{ value: "perspective", label: t.perspective }, { value: "status", label: t.status }]} />
        </div>
        <div className="flex gap-2">
          <Chip count={a.kpiRows.length - na} label={t.allKpis} active={filter === "all"} onClick={() => setFilter("all")} />
          <Chip count={a.onTrack} label={t.onTrack} tone="ok" active={filter === "on"} onClick={() => setFilter("on")} />
          <Chip count={a.offTrack} label={t.offTrack} tone="bad" active={filter === "off"} onClick={() => setFilter("off")} />
        </div>
      </div>
      <div className="mx-auto max-w-5xl" data-testid="kpi-arc">
        <KpiArc items={items} pctOn={pctOn} period={T.pl(a.view.window.short)} />
      </div>
      <p className="text-center text-xs text-mute">
        {t.explorerFoot(a.kpiRows.length, na)} · <span className="text-green-d">{t.onUpper(a.onTrack)}</span> · <span className="text-red">{t.offUpper(a.offTrack)}</span>
      </p>
    </>
  );
}
