"use client";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { analyze, defaultEnd, hasPL, indexMonths, isAnnualColumn, type Comparison, type PeriodSel, type PeriodType } from "@/lib/engine";
import { useCompany } from "./context";
import { useLang } from "@/lib/i18n/context";
import { inLang } from "@/lib/i18n/script";
import { kpiName } from "@/lib/i18n/kpis";
import { budgetAccounts, budgetComparison, budgetFor, budgetTargets } from "@/lib/engine/budget";
import type { CompanyBundle } from "./types";

/** Period selection lives in the URL (?type=month&end=2026-09&cmp=target) so views are shareable. */
export function usePeriod(own?: string[]) {
  const company = useCompany();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Months that can end a period: those holding a P&L (an opening balance month alone is not a period of activity).
  // A module with its own history (Inventory) passes its months instead.
  const periods = useMemo(() => own ?? indexMonths(company.months).sorted.filter(hasPL).map((m) => m.period), [company.months, own]);
  const latest = periods[periods.length - 1];
  const endRaw = sp.get("end");
  // Opens on the last full month (a part month at the end is one click away); a module's own months open on its latest.
  const end = endRaw && periods.includes(endRaw) ? endRaw : own ? latest : defaultEnd(periods, company.asOf) ?? latest;
  // Audited annual columns are read as years; everything else opens on a month.
  const annual = end && !own ? isAnnualColumn(company.months, end, company.settings.fyStartMonth) : false;
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
    () => (sel.end ? analyze(company.months, sel, company.settings, { comparison: cmp, alerts: company.alerts, asOf: company.asOf, lang, kpiName: (d) => kpiName(d, lang), budgetTargets: targetsFromBudget(company, sel) }) : null),
    [company.months, company.settings, company.alerts, company.asOf, company.budgets, company.budgetTargets, sel.type, sel.end, cmp, lang], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

/** Saved commentary for the current period (falls back to period-less notes, e.g. the demo company). */
export function useComments() {
  const company = useCompany();
  const { sel } = usePeriod();
  const key = `${sel.type}:${sel.end}`;
  const lang = useLang();
  // Saved text in the other language gives way to the page's own automatic notes.
  return (section: string): string | undefined => inLang(company.commentary[`${key}|${section}`] ?? company.commentary[section], lang);
}

/** The approved budget's targets for the selected window, when the company uses its budget as targets. */
function targetsFromBudget(c: CompanyBundle, sel: PeriodSel): Record<string, number | null> | null {
  const b = c.budgetTargets ? budgetFor(c.budgets, sel.end, c.settings.fyStartMonth) : null;
  if (!b) return null;
  const day = c.asOf && c.asOf.startsWith(sel.end) ? Number(c.asOf.slice(8)) : undefined;
  const acc = budgetAccounts(b.lines, b.products).accounts;
  return budgetTargets(budgetComparison(acc, sel, c.settings.fyStartMonth, b.name, day).P);
}
