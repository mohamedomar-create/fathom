"use client";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { analyze, hasPL, indexMonths, isAnnualColumn, type Comparison, type PeriodSel, type PeriodType } from "@/lib/engine";
import { useCompany } from "./context";
import { useLang } from "@/lib/i18n/context";
import { kpiName } from "@/lib/i18n/kpis";

/** Period selection lives in the URL (?type=month&end=2026-09&cmp=target) so views are shareable. */
export function usePeriod() {
  const company = useCompany();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Months that can end a period: those holding a P&L (an opening balance month alone is not a period of activity).
  const periods = useMemo(() => indexMonths(company.months).sorted.filter(hasPL).map((m) => m.period), [company.months]);
  const latest = periods[periods.length - 1];
  const endRaw = sp.get("end");
  const end = endRaw && periods.includes(endRaw) ? endRaw : latest;
  // Audited annual columns are read as years; everything else opens on the latest month.
  const annual = end ? isAnnualColumn(company.months, end, company.settings.fyStartMonth) : false;
  const type = (annual ? "year" : ["month", "quarter", "year"].includes(sp.get("type") ?? "") ? sp.get("type") : "month") as PeriodType;
  const cmp = (["target", "prior", "ly"].includes(sp.get("cmp") ?? "") ? sp.get("cmp") : "target") as Comparison;
  const sel: PeriodSel = { type, end };
  const set = useCallback(
    (patch: Partial<{ type: PeriodType; end: string; cmp: Comparison }>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );
  return { sel, cmp, set, periods, latest, query: sp.toString() };
}

export function useAnalysis() {
  const company = useCompany();
  const { sel, cmp } = usePeriod();
  const lang = useLang();
  return useMemo(
    () => (sel.end ? analyze(company.months, sel, company.settings, { comparison: cmp, alerts: company.alerts, asOf: company.asOf, lang, kpiName: (d) => kpiName(d, lang) }) : null),
    [company.months, company.settings, company.alerts, company.asOf, sel.type, sel.end, cmp, lang], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

/** Saved commentary for the current period (falls back to period-less notes, e.g. the demo company). */
export function useComments() {
  const company = useCompany();
  const { sel } = usePeriod();
  const key = `${sel.type}:${sel.end}`;
  return (section: string): string | undefined => company.commentary[`${key}|${section}`] ?? company.commentary[section];
}
