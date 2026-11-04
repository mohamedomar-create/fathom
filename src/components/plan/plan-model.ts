"use client";
import { useMemo } from "react";
import { byYear, indicators, planChecks, planRows, projectMonths, ratiosOf, type BusinessPlan, type PlanPeriod, type ScenarioName } from "@/lib/engine/plan";

export const SCENARIOS: { id: ScenarioName; label: string }[] = [
  { id: "worst", label: "Worst case" }, { id: "base", label: "Base case" }, { id: "best", label: "Best case" },
];

/** The figures of one scenario, worked out once. */
export function usePlanMath(p: BusinessPlan, sc: ScenarioName = "base") {
  return useMemo(() => {
    const months = projectMonths(p, sc);
    const years = byYear(months);
    return { months, years, ind: indicators(p, months), checks: planChecks(p, months), ratios: ratiosOf(years) };
  }, [p, sc]);
}

export type Line = [keyof PlanPeriod, string, ("total" | "sub")?];
export const PL: Line[] = [
  ["revenue", "Sales", "sub"], ["cogs", "Cost of sales"], ["gross", "Gross profit", "sub"], ["staff", "Staff"], ["overheads", "Overheads"],
  ["ebitda", "EBITDA", "sub"], ["depreciation", "Depreciation"], ["interest", "Interest"], ["tax", "Income tax"], ["net", "Net profit", "total"],
];
export const BS: Line[] = [
  ["cash", "Cash"], ["receivables", "Customers"], ["inventory", "Stock"], ["fixedAssets", "Fixed assets"], ["otherAssets", "Other assets"], ["assets", "Total assets", "total"],
  ["payables", "Suppliers"], ["taxPayable", "Income tax due"], ["loans", "Loans"], ["otherLiabilities", "Other liabilities"], ["liabilities", "Total liabilities", "sub"], ["equity", "Equity", "total"],
];
export const CF: Line[] = [["operating", "From operations"], ["investing", "Investments"], ["financing", "Financing"], ["netCash", "Net change in cash", "sub"], ["cash", "Cash at the end", "total"]];

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** Every scenario's statements as one CSV file (opens in Excel). */
export function downloadPlan(p: BusinessPlan, t: (en: string) => string) {
  const rows = SCENARIOS.flatMap((s) => [[t(s.label)], ...planRows(p, s.id, t), []]);
  const text = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${p.name}.csv`; a.click();
  URL.revokeObjectURL(url);
}
