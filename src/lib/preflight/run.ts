import type { Grid } from "@/lib/ingest/extract";
import { cleanWorkbook, type Cleaned } from "./clean";
import { inspectWorkbook } from "./inspect";
import type { Decisions, PreflightModule, PreflightReport } from "./types";

export interface PreflightRun { report: PreflightReport; cleaned: Cleaned; final: PreflightReport }

/**
 * The whole preflight in one go: inspect the upload with the person's decisions, build the cleaned copy, and inspect
 * the copy again. Only a copy whose own report is ready ("every rule passes") may be imported.
 */
export function runPreflight(grids: Grid[], module: PreflightModule, decisions: Decisions, stockMapping?: Record<string, string>): PreflightRun {
  const report = inspectWorkbook(grids, module, { decisions, stockMapping });
  const cleaned = cleanWorkbook(grids, report, decisions);
  // On the copy the headings are on its first row and left-out rows are gone; the other answers still hold.
  const after: Decisions = Object.fromEntries(Object.entries(decisions).map(([k, d]) => [k, { ...d, headerRow: undefined, exclude: undefined, include: true }]));
  for (const g of cleaned.grids) after[g.name] ??= { include: true };
  const final = inspectWorkbook(cleaned.grids, module, { decisions: after, stockMapping });
  return { report, cleaned, final };
}
