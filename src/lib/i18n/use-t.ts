"use client";
import { useMemo } from "react";
import { dict, monthLabel, monthNames, periodLabel } from ".";
import { useLang } from "./context";
import { tl } from "./lines";
import { kpiName, numIn } from "./kpis";
import type { KpiDef } from "@/lib/engine";

/**
 * Everything a page needs to speak the chosen language: its words, fixed engine names (statement lines, groups), months and
 * periods, KPI names and figures with units.
 */
export function useT() {
  const lang = useLang();
  return useMemo(() => ({
    lang,
    d: dict(lang),
    /** A fixed engine name ("Gross Profit", "OPERATING CASH FLOW") in the chosen language. */
    tl: (s: string) => tl(s, lang),
    /** "2026-09" → "Sep 2026" / "سبتمبر 2026". */
    ml: (p: string) => monthLabel(p, lang),
    /** "2026-09" → "Sep" / "سبتمبر" (chart axes). */
    ms: (p: string) => `${monthNames(lang)[Number(p.slice(5, 7))]} ${p.slice(2, 4)}`,
    /** An engine period label ("Q3 2026", "Year 2026 (to Aug)"). */
    pl: (s: string) => periodLabel(s, lang),
    kn: (def: KpiDef) => kpiName(def, lang),
    num: (v: number | null | undefined, unit: KpiDef["unit"], cur: string) => numIn(v, unit, cur, lang),
  }), [lang]);
}
