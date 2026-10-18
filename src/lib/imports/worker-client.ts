"use client";
import type { ExportKey, SavedMapping } from "@/lib/ingest/odoo-templates";
import { parseFiles, sampleFile, type FileSample, type ParseResult } from "./prepare";
import { readWorkbooks } from "@/lib/ingest/read";
import type { Grid } from "@/lib/ingest/extract";

export type WorkerRequest =
  | { id: number; type: "read"; files: { name: string; data: ArrayBuffer }[] }
  | { id: number; type: "sample"; files: { name: string; data: ArrayBuffer; export?: ExportKey | null }[]; saved: Partial<Record<ExportKey, SavedMapping>> }
  | { id: number; type: "parse"; files: { name: string; data: ArrayBuffer; export: ExportKey; mapping?: SavedMapping }[]; opts: { rentalLocation: string | null; asOf: string; timeZone?: string | null; cutoff?: string | null } };
export type WorkerResponse =
  | { id: number; type: "read"; grids: Grid[] }
  | { id: number; type: "sample"; samples: FileSample[] }
  | { id: number; type: "parse"; result: ParseResult }
  | { id: number; type: "progress"; done: number; of: number }
  | { id: number; type: "error"; message: string };

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
    return (r.type === "read"
      ? readWorkbooks(r.files).then((grids) => ({ id, type: "read", grids }))
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

export async function parseInWorker(files: { file: File; export: ExportKey; mapping?: SavedMapping }[], opts: { rentalLocation: string | null; asOf: string; timeZone?: string | null; cutoff?: string | null }, onProgress?: (done: number, of: number) => void): Promise<ParseResult> {
  const data = await Promise.all(files.map(async (f) => ({ name: f.file.name, data: await f.file.arrayBuffer(), export: f.export, mapping: f.mapping })));
  return (await run<Extract<WorkerResponse, { type: "parse" }>>({ type: "parse", files: data, opts }, onProgress)).result;
}

/** Any spreadsheet upload, read into sheets off the page's main thread (the page stays responsive on large files). */
export async function readInWorker(files: { name: string; data: ArrayBuffer }[]): Promise<Grid[]> {
  return (await run<Extract<WorkerResponse, { type: "read" }>>({ type: "read", files })).grids;
}
