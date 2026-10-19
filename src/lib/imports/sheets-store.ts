import type { Grid } from "@/lib/ingest/extract";
import { computeIngest, deriveLedgerLines, slimOutcome, type IngestOutcome } from "@/lib/ingest/wizard-ingest";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";

/**
 * The upload's sheets are kept where they are read (the worker), under a token: re-reading with a correction sends only
 * the corrections, never the sheets again, and the last reading is kept there to work out the ledger's lines.
 */
const kept = new Map<string, { grids: Grid[]; last?: IngestOutcome }>();
/** Only the latest upload's sheets are kept. */
export function keepSheets(token: string, grids: Grid[]) { kept.clear(); kept.set(token, { grids }); }
export function handleSheets(r: Extract<WorkerRequest, { type: "put" | "ingest" | "derive" }>): WorkerResponse {
  if (r.type === "put") {
    keepSheets(r.token, r.grids);
    return { id: r.id, type: "put" };
  }
  const k = kept.get(r.token);
  if (!k) return { id: r.id, type: "error", message: "The upload was reset. Choose the file again." };
  if (r.type === "ingest") {
    const names = new Set(r.sheets);
    k.last = computeIngest(k.grids.filter((g) => names.has(g.name)), r.params);
    return { id: r.id, type: "ingest", outcome: slimOutcome(k.last) };
  }
  if (!k.last?.res) return { id: r.id, type: "error", message: "Read the file first." };
  return { id: r.id, type: "derive", lines: deriveLedgerLines(k.last.res.lines) };
}

