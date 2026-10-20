// The server's own checks, so nothing depends on the page alone: a stored file is inspected again before its rows are
// sent, and lines are refused, naming the line, when they break a rule of their module.
import type { ZodError } from "zod";
import type { Grid } from "@/lib/ingest/extract";
import { inspectWorkbook } from "./inspect";
import type { PreflightModule } from "./types";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Why an upload cannot be imported (the first blocking issue of a sheet that would go in), or null when it can. */
export function preflightGate(grids: Grid[], module: PreflightModule, opts: { stockMapping?: Record<string, string> } = {}): string | null {
  const r = inspectWorkbook(grids, module, { stockMapping: opts.stockMapping });
  for (const s of r.sheets) {
    if (!s.include) continue;
    const block = s.issues.find((i) => i.level === "block");
    if (block) return `${s.sheet}: ${block.message}${block.needs ? ` ${block.needs}` : ""}`;
  }
  return r.sheets.some((s) => s.include) ? null : "No sheet in this file can be imported.";
}

/** The first line whose day is not in its own month (a line counts in its month; its date must agree). */
export function lineProblem(lines: { day?: string | null; period: string }[], what: string): string | null {
  const i = lines.findIndex((l) => l.day && l.day.slice(0, 7) !== l.period);
  return i < 0 ? null : `${cap(what)} ${i + 1}: its date ${lines[i].day} is not in its month ${lines[i].period}.`;
}

/** A schema failure on a list of lines, said with the line number and the field. */
export function zodProblem(error: ZodError, what: string): string {
  const issue = error.issues[0];
  if (!issue) return `The ${what}s are not valid.`;
  const [i, field] = issue.path;
  return typeof i === "number" ? `${cap(what)} ${i + 1}${field !== undefined ? `, ${String(field)}` : ""}: ${issue.message}` : `The ${what}s are not valid: ${issue.message}`;
}
