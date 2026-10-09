"use client";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { analyze, indexMonths, type Comparison, type PeriodSel, type PeriodType } from "@/lib/engine";
import { useCompany } from "./context";

/** Period selection lives in the URL (?type=month&end=2026-09&cmp=target) so views are shareable. */
export function usePeriod() {
  const company = useCompany();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const periods = useMemo(() => indexMonths(company.months).sorted.map((m) => m.period), [company.months]);
  const latest = periods[periods.length - 1];
  const type = (["month", "quarter", "year"].includes(sp.get("type") ?? "") ? sp.get("type") : "month") as PeriodType;
  const endRaw = sp.get("end");
  const end = endRaw && periods.includes(endRaw) ? endRaw : latest;
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
  return useMemo(
    () => (sel.end ? analyze(company.months, sel, company.settings, { comparison: cmp, alerts: company.alerts }) : null),
    [company.months, company.settings, company.alerts, sel.type, sel.end, cmp], // eslint-disable-line react-hooks/exhaustive-deps
  );
}
