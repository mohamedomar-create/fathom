"use client";
import type { ExportKey, SavedMapping } from "@/lib/ingest/odoo-templates";
import { parseFiles, sampleFile, type FileSample, type ParseResult } from "./prepare";
import { readWorkbooks } from "@/lib/ingest/read";
import type { Grid } from "@/lib/ingest/extract";
import { planPaymentsUpload, type PaymentsUploadPlan } from "@/lib/ingest/payments-upload";
import type { IngestOutcome, IngestParams, LedgerLines } from "@/lib/ingest/wizard-ingest";

export type { WorkerRequest, WorkerResponse } from "./worker-protocol";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol";
import { handleSheets, keepSheets } from "./sheets-store";
import { runPreflight, type PreflightRun } from "@/lib/preflight/run";
import type { Decisions, PreflightModule } from "@/lib/preflight";

let worker: Worker | null = null;
let next = 1;
function getWorker(): Worker | null {
  if (worker) return worker;
  try { worker = new Worker(new URL("./import.worker.ts", import.meta.url), { type: "module" }); } catch { worker = null; }
  return worker;
}

/** Runs one request in the background thread (or here, when the browser has no workers), with progress. */
type NoId<T> = T extends unknown ? Omit<T, "id"> : never;
function run<T extends WorkerResponse>(req: NoId<WorkerRequest>, onProgress?: (done: number, of: number) => void): Promise<T> {
  const w = getWorker();
  const id = next++;
  if (!w) {
    // No worker (very old browser, or tests): the same functions, on this thread.
    const r = { ...req, id } as WorkerRequest;
    if (r.type === "put" || r.type === "ingest" || r.type === "derive") return Promise.resolve(handleSheets(r)) as Promise<T>;
    return (r.type === "read"
      ? readWorkbooks(r.files).then((grids) => { if (r.keep) keepSheets(r.keep, grids); return { id, type: "read", grids }; })
      : r.type === "payments"
      ? (r.grids ? Promise.resolve(r.grids) : readWorkbooks(r.files)).then((grids) => ({ id, type: "payments", plan: planPaymentsUpload(grids, { currency: r.currency }) }))
      : r.type === "preflight"
      ? Promise.resolve({ id, type: "preflight", ...runPreflight(r.grids, r.module, r.decisions, r.stockMapping, r.stockKey, r.simple) })
      : r.type === "sample"
      ? Promise.all(r.files.map((f) => sampleFile(f.name, f.data, r.saved, f.export ?? null))).then((samples) => ({ id, type: "sample", samples }))
      : parseFiles(r.files, r.opts, onProgress).then((result) => ({ id, type: "parse", result }))) as Promise<T>;
  }
  return new Promise<T>((resolve, reject) => {
    const on = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.id !== id) return;
      if (m.type === "progress") { onProgress?.(m.done, m.of); return; }
      w.removeEventListener("message", on);
      if (m.type === "error") reject(new Error(m.message)); else resolve(m as T);
    };
    w.addEventListener("message", on);
    w.addEventListener("error", (e) => { w.removeEventListener("message", on); worker = null; reject(new Error(e.message || "The file reader stopped.")); }, { once: true });
    // The bytes are copied, not moved: the same file is also uploaded to storage.
    w.postMessage({ ...req, id });
  });
}

export async function sampleInWorker(files: File[], saved: Partial<Record<ExportKey, SavedMapping>>, forced: Record<string, ExportKey | null> = {}): Promise<FileSample[]> {
  const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer(), export: forced[f.name] ?? null })));
  return (await run<Extract<WorkerResponse, { type: "sample" }>>({ type: "sample", files: data, saved })).samples;
}

export async function parseInWorker(files: { file: File; export: ExportKey; mapping?: SavedMapping }[], opts: { rentalLocation: string | null; asOf: string; timeZone?: string | null; cutoff?: string | null; locationTypes?: Record<string, "internal" | "transit" | "rental" | "outside"> }, onProgress?: (done: number, of: number) => void): Promise<ParseResult> {
  const data = await Promise.all(files.map(async (f) => ({ name: f.file.name, data: await f.file.arrayBuffer(), export: f.export, mapping: f.mapping })));
  return (await run<Extract<WorkerResponse, { type: "parse" }>>({ type: "parse", files: data, opts }, onProgress)).result;
}

/** Any spreadsheet upload, read into sheets off the page's main thread (the page stays responsive on large files). */
export async function readInWorker(files: { name: string; data: ArrayBuffer }[]): Promise<Grid[]> {
  return (await run<Extract<WorkerResponse, { type: "read" }>>({ type: "read", files })).grids;
}

/** Ageing reports and payments lists from sheets already read (and checked by preflight), off the page's main thread. */
export async function planPaymentsFromGrids(grids: Grid[], currency: string): Promise<PaymentsUploadPlan> {
  return (await run<Extract<WorkerResponse, { type: "payments" }>>({ type: "payments", files: [], grids, currency })).plan;
}
/** Ageing reports and payments lists: read and checked off the page's main thread. */
export async function planPaymentsInWorker(files: File[], currency: string): Promise<PaymentsUploadPlan> {
  const data = await Promise.all(files.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() })));
  return (await run<Extract<WorkerResponse, { type: "payments" }>>({ type: "payments", files: data, currency })).plan;
}

let tokens = 0;
const newToken = () => `t${Date.now()}-${tokens++}`;
/** Reads an upload's spreadsheets off the page, keeping the sheets in the worker for the readings that follow. */
export async function readForUpload(files: { name: string; data: ArrayBuffer }[]): Promise<{ grids: Grid[]; token: string }> {
  const token = newToken();
  return { grids: (await run<Extract<WorkerResponse, { type: "read" }>>({ type: "read", files, keep: token })).grids, token };
}
/** Hands the upload's sheets to the worker once; returns the token later readings use. */
export async function putSheets(grids: Grid[]): Promise<string> {
  const token = newToken();
  await run({ type: "put", token, grids });
  return token;
}
/** Reads the accounts (or opening balances) from the kept sheets, with the person's corrections, off the page. */
export async function ingestInWorker(token: string, sheets: string[], params: IngestParams): Promise<IngestOutcome> {
  return (await run<Extract<WorkerResponse, { type: "ingest" }>>({ type: "ingest", token, sheets, params })).outcome;
}
/** The ledger's sales, expense, stock and payment lines, from the last reading, off the page. */
export async function deriveInWorker(token: string): Promise<LedgerLines> {
  return (await run<Extract<WorkerResponse, { type: "derive" }>>({ type: "derive", token })).lines;
}

/** Preflight off the page: the report, the cleaned copy with the person's decisions, and the cleaned copy's own report. */
export async function preflightInWorker(grids: Grid[], module: PreflightModule, decisions: Decisions, stockMapping?: Record<string, string>, stockKey?: string, simple?: boolean): Promise<PreflightRun> {
  const { report, cleaned, final } = await run<Extract<WorkerResponse, { type: "preflight" }>>({ type: "preflight", grids, module, decisions, stockMapping, stockKey, simple });
  return { report, cleaned, final };
}
