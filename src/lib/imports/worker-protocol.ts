// The messages between the page and the upload worker (types only: the worker and the page each import this, never
// each other, so the bundler never sees a loop).
import type { ExportKey, SavedMapping } from "@/lib/ingest/odoo-templates";
import type { FileSample, ParseResult } from "./prepare";
import type { Grid } from "@/lib/ingest/extract";
import type { PaymentsUploadPlan } from "@/lib/ingest/payments-upload";
import type { IngestOutcome, IngestParams, LedgerLines } from "@/lib/ingest/wizard-ingest";
import type { Cleaned, Decisions, PreflightModule, PreflightReport } from "@/lib/preflight";

export type WorkerRequest =
  | { id: number; type: "read"; files: { name: string; data: ArrayBuffer }[]; keep?: string }
  | { id: number; type: "payments"; files: { name: string; data: ArrayBuffer }[]; grids?: Grid[]; currency: string }
  | { id: number; type: "put"; token: string; grids: Grid[] }
  | { id: number; type: "ingest"; token: string; sheets: string[]; params: IngestParams }
  | { id: number; type: "derive"; token: string }
  | { id: number; type: "sample"; files: { name: string; data: ArrayBuffer; export?: ExportKey | null }[]; saved: Partial<Record<ExportKey, SavedMapping>> }
  | { id: number; type: "preflight"; grids: Grid[]; module: PreflightModule; decisions: Decisions; stockMapping?: Record<string, string>; stockKey?: string }
  | { id: number; type: "parse"; files: { name: string; data: ArrayBuffer; export: ExportKey; mapping?: SavedMapping }[]; opts: { rentalLocation: string | null; asOf: string; timeZone?: string | null; cutoff?: string | null; locationTypes?: Record<string, "internal" | "transit" | "rental" | "outside"> } };
export type WorkerResponse =
  | { id: number; type: "read"; grids: Grid[] }
  | { id: number; type: "payments"; plan: PaymentsUploadPlan }
  | { id: number; type: "put" }
  | { id: number; type: "ingest"; outcome: IngestOutcome }
  | { id: number; type: "derive"; lines: LedgerLines }
  | { id: number; type: "sample"; samples: FileSample[] }
  | { id: number; type: "parse"; result: ParseResult }
  | { id: number; type: "preflight"; report: PreflightReport; cleaned: Cleaned; final: PreflightReport }
  | { id: number; type: "progress"; done: number; of: number }
  | { id: number; type: "error"; message: string };

