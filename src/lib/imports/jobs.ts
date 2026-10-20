"use client";
import * as tus from "tus-js-client";
import { createClient } from "@/lib/supabase/client";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import type { ImportFileRow, ImportJobRow, Json } from "@/lib/supabase/database.types";
import type { ExportKey, SavedMapping } from "@/lib/ingest/odoo-templates";
import { ODOO_TEMPLATES } from "@/lib/ingest/odoo-templates";
import type { ParseResult, StagedRecord } from "./prepare";
import { parseInWorker } from "./worker-client";
import { isTransient, missingOf, stageRows, type Range } from "./stage";

/**
 * An import, from the browser straight to Supabase (never through the web server):
 *  1. the files are read in the background thread (a file with nothing to import never creates a job);
 *  2. the job is created (one row per file, each with its storage path);
 *  3. at the same time: each original file is uploaded to storage (resumable, 6 MB chunks), and the rows are sent to the
 *     database in small batches (see stage.ts: a busy database splits a batch, never stalls the upload);
 *  4. the job is queued: the database checks and saves it in the background. The page can be closed from here.
 * If the page is closed earlier, choosing the same files again continues the same job.
 */
export type ImportMode = "replace" | "add" | "all" | "update";
export interface ImportFile { file: File; export: ExportKey; mapping?: SavedMapping }
/** server: the files are uploaded and the server is sending the rows; the page can be closed. */
export interface ImportProgress { phase: "starting" | "working" | "server" | "queued"; job?: string; upload: number; read: number; send: number; note?: string }

const BUCKET = "imports";
const supabase = () => createClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A plain message for the database's refusals. */
export function importError(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (/RATE/.test(m)) return "Too many imports in the last hour. Try again later.";
  if (/not allowed|42501|permission/i.test(m)) return "You need edit rights on this company to import.";
  if (/NOT_PREPARING/.test(m)) return "This import is no longer open. Start a new one.";
  if (/MISSING_ROWS/.test(m)) return "Some rows did not arrive. Choose the same files again to continue.";
  if (isTransient(m)) return "The database was busy and some rows did not arrive. Press “Continue” on this import to send only the rows still missing.";
  if (/NOT_STORED/.test(m)) return "The original file did not finish uploading. Choose the same files again to continue.";
  if (/create_import_job|import_jobs|schema cache|PGRST202|42883/i.test(m)) return "Imports are not switched on for this database yet. Ask your administrator to apply the import update (migration 0014).";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "The connection dropped. Choose the same files again to continue where it stopped.";
  return m.replace(/^[A-Z_]+: /, "");
}

async function retry<T>(f: () => PromiseLike<T>, tries = 5): Promise<T> {
  for (let k = 0; ; k++) {
    try { return await f(); } catch (e) {
      if (k >= tries - 1 || /not allowed|NOT_PREPARING|RATE|42501/.test(String((e as Error)?.message))) throw e;
      await sleep(1000 * 2 ** k);
    }
  }
}
const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await (supabase().rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: T; error: { message: string } | null }>)(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

/** The original file, uploaded to storage in resumable 6 MB chunks (Supabase's TUS endpoint), with progress. */
export function uploadOriginal(file: File, path: string, onProgress: (sent: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const sb = supabase();
    const up = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
      headers: { apikey: SUPABASE_ANON_KEY, "x-upsert": "false" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      metadata: { bucketName: BUCKET, objectName: path, contentType: file.type || "application/octet-stream", cacheControl: "3600" },
      // Resume only this file into this job's path (never into another job's).
      fingerprint: async () => ["ireport", path, file.size, file.lastModified].join(":"),
      // A long upload can outlive the sign-in token: each request takes the current one.
      onBeforeRequest: async (req) => { const { data } = await sb.auth.getSession(); req.setHeader("authorization", `Bearer ${data.session?.access_token ?? SUPABASE_ANON_KEY}`); },
      onProgress: (sent, total) => onProgress(sent, total),
      onError: (e) => reject(e),
      onSuccess: () => resolve(),
    });
    up.findPreviousUploads().then((prev) => { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); }, () => up.start());
  });
}

/** Sends a file's records; on a continued upload, only the ones the database does not hold yet. */
export async function stageRecords(fileId: string, records: StagedRecord[], onSent: (sent: number) => void, resume = false): Promise<void> {
  let missing: Range[] | undefined;
  if (resume) {
    const held = await retry(() => rpc<Range[]>("import_held", { p_file: fileId }));
    missing = missingOf(records.reduce((m, r) => Math.max(m, r.n), 0), held ?? []);
    const already = records.length - records.filter((r) => missing!.some(([a, b]) => r.n >= a && r.n <= b)).length;
    onSent(already);
    if (!missing.length) return;
    await stageRows(records, (b) => rpc<number>("stage_import_rows", { p_file: fileId, p_rows: b as unknown as Json }), (n) => onSent(already + n), { missing });
    return;
  }
  await stageRows(records, (b) => rpc<number>("stage_import_rows", { p_file: fileId, p_rows: b as unknown as Json }), onSent);
}

/** Jobs this page is sending right now (a preparing job no page is sending was interrupted). */
const activeHere = new Set<string>();
export const isActiveHere = (job: string) => activeHere.has(job);

const PENDING = "ireport-import:";
type Pending = { job: string; company: string; files: { name: string; size: number; lastModified: number; id: string; path: string; export: ExportKey }[] };
/** Jobs this browser started and has not finished sending (to continue after the page was closed). */
export function pendingJob(job: string): Pending | null {
  try { return JSON.parse(localStorage.getItem(PENDING + job) ?? "null"); } catch { return null; }
}
const keepPending = (p: Pending) => { try { localStorage.setItem(PENDING + p.job, JSON.stringify(p)); } catch { /* private mode */ } };
const dropPending = (job: string) => { try { localStorage.removeItem(PENDING + job); } catch { /* private mode */ } };

/**
 * Runs an import up to the point the database takes over. `resume`: an earlier job of this browser to continue (the same
 * files chosen again).
 */
export async function startImport(companyId: string, mode: ImportMode, files: ImportFile[], options: { rentalLocation: string | null; asOf: string; timeZone?: string | null; cutoff?: string | null; locationTypes?: Record<string, "internal" | "transit" | "rental" | "outside"> }, onProgress: (p: ImportProgress) => void, resume?: string): Promise<{ job: string; parsed: ParseResult }> {
  const p: ImportProgress = { phase: "starting", upload: 0, read: 0, send: 0 };
  const tell = () => onProgress({ ...p });
  tell();
  // Read first: a file with nothing to import never leaves a job behind.
  const parsed = await parseInWorker(files.map((f) => ({ file: f.file, export: f.export, mapping: f.mapping })), options, (done, of) => { p.read = done / of; tell(); });
  p.read = 1; tell();
  if (!parsed.files.some((f) => f.records.length)) throw new Error("Nothing to import: no rows were found in these files.");
  let job: string, stored: Pending["files"];
  if (resume) {
    const prev = pendingJob(resume);
    if (!prev) throw new Error("This import cannot be continued from this browser. Start a new one.");
    const byName = new Map(files.map((f) => [f.file.name, f]));
    if (prev.files.some((f) => { const x = byName.get(f.name); return !x || x.file.size !== f.size; })) throw new Error(`Choose the same files as before: ${prev.files.map((f) => f.name).join(", ")}.`);
    job = prev.job; stored = prev.files;
  } else {
    const r = await rpc<{ job: string; files: { id: string; name: string; path: string }[] }>("create_import_job", {
      p_company: companyId, p_kind: "inventory", p_mode: mode,
      p_files: files.map((f) => ({ name: f.file.name, size: f.file.size, export: f.export, kind: ODOO_TEMPLATES[f.export].kind })) as unknown as Json,
      p_options: options as unknown as Json,
    });
    job = r.job;
    stored = r.files.map((x, i) => ({ name: files[i].file.name, size: files[i].file.size, lastModified: files[i].file.lastModified, id: x.id, path: x.path, export: files[i].export }));
    keepPending({ job, company: companyId, files: stored });
  }
  p.job = job; p.phase = "working"; tell();
  activeHere.add(job);
  try {
  const total = files.reduce((s, f) => s + f.file.size, 0) || 1;
  const sentBytes = new Map<string, number>();
  const fileOf = (name: string) => files.find((f) => f.file.name === name)!;
  const parsedOf = (name: string) => parsed.files[files.indexOf(fileOf(name))];

  const all = parsed.files.reduce((s, f) => s + f.records.length, 0) || 1;
  const totals = Object.fromEntries(stored.map((s) => [s.id, parsedOf(s.name).records.length]));
  const queue = () => retry(() => rpc("queue_import_job", { p_job: job, p_totals: totals as unknown as Json })).catch((e) => {
    // The server queued it first: nothing left to do.
    if (/NOT_PREPARING/.test(String((e as Error)?.message))) return;
    throw e;
  });
  const uploads = Promise.all(stored.map(async (s) => {
    // On a continued upload, a file already in storage is not sent again (storage refuses a second copy).
    if (resume && await rpc("mark_import_file_stored", { p_file: s.id }).then(() => true, () => false)) { sentBytes.set(s.id, s.size); return; }
    await uploadOriginal(fileOf(s.name).file, s.path, (sent) => { sentBytes.set(s.id, sent); p.upload = [...sentBytes.values()].reduce((a, b) => a + b, 0) / total; tell(); });
    await retry(() => rpc("mark_import_file_stored", { p_file: s.id }));
  }));
  const sendHere = async (continuing: boolean) => {
    const sent = new Map<string, number>();
    for (const s of stored) {
      await stageRecords(s.id, parsedOf(s.name).records, (n) => { sent.set(s.id, n); p.send = [...sent.values()].reduce((a, b) => a + b, 0) / all; tell(); }, continuing);
    }
  };
  await uploads;
  // The files are in storage: the server reads them and sends the rows, so this page can be closed. While it stays open
  // it follows the server, and sends the missing rows itself if the server stops (or cannot be reached).
  if (await handOff(job, Object.fromEntries(stored.flatMap((s) => (fileOf(s.name).mapping ? [[s.id, fileOf(s.name).mapping!]] : []))))) {
    p.phase = "server"; tell();
    const finished = await followServer(job, stored.map((s) => s.id), all, (f) => { p.send = f; tell(); });
    if (!finished) { p.phase = "working"; tell(); await sendHere(true); await queue(); }
  } else {
    await sendHere(!!resume);
    await queue();
  }
  dropPending(job);
  p.phase = "queued"; p.upload = 1; p.send = 1; tell();
  return { job, parsed };
  } finally { activeHere.delete(job); }
}

class Refused extends Error {}
/** Asks the server to read the stored files and send their rows. False: it could not take over (the page does it). */
async function handOff(job: string, mappings: Record<string, SavedMapping>): Promise<boolean> {
  try {
    const r = await fetch(`/api/imports/${job}/stage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mappings }) });
    // The server's preflight refused the stored file: the page must not send its rows either.
    if (r.status === 422) { const why = String((await r.json().catch(() => ({})) as { error?: string }).error ?? ""); if (/^PREFLIGHT/.test(why)) throw new Refused(why); }
    return r.status === 202;
  } catch (e) {
    if (e instanceof Refused) throw e;
    return false;
  }
}

/** Rows the database holds for a file, from its held ranges. */
const heldCount = (held: Range[] | null) => (held ?? []).reduce((s, [a, b]) => s + b - a + 1, 0);

/**
 * Follows the server until it has queued the job (true), or until nothing has arrived for STALL_MS (false: the server
 * stopped, and the page sends the rest itself). The server has read the files before taking over, so rows arrive at once.
 */
async function followServer(job: string, files: string[], total: number, onSent: (fraction: number) => void, STALL_MS = 45_000): Promise<boolean> {
  let last = -1, since = Date.now();
  for (;;) {
    await sleep(2000);
    const { data } = await supabase().from("import_jobs").select("status").eq("id", job).maybeSingle();
    if (data && data.status !== "preparing") return true;
    const held = (await Promise.all(files.map((f) => rpc<Range[]>("import_held", { p_file: f }).catch(() => null)))).reduce((s, h) => s + heldCount(h), 0);
    onSent(Math.min(1, held / total));
    if (held !== last) { last = held; since = Date.now(); } else if (Date.now() - since > STALL_MS) return false;
  }
}

export interface JobView extends ImportJobRow { files: ImportFileRow[] }
export async function listJobs(companyId: string): Promise<JobView[]> {
  const sb = supabase();
  const { data: jobs, error } = await sb.from("import_jobs").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(15);
  if (error) throw new Error(error.message);
  if (!jobs?.length) return [];
  const { data: files } = await sb.from("import_files").select("*").in("job_id", jobs.map((j) => j.id)).order("created_at");
  return jobs.map((j) => ({ ...j, files: (files ?? []).filter((f) => f.job_id === j.id) }));
}

/** The rows a job could not read (first 500): file, row in the sheet, why. */
export async function jobErrors(jobId: string): Promise<{ file_id: string; line: number | null; error: string }[]> {
  const { data, error } = await supabase().from("import_rows").select("file_id, line, error").eq("job_id", jobId).not("error", "is", null).order("file_id").order("n").limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as { file_id: string; line: number | null; error: string }[];
}

export const actOnJob = (jobId: string, action: "cancel" | "accept" | "retry") => rpc("act_on_import_job", { p_job: jobId, p_action: action });

export async function savedTemplates(companyId: string): Promise<Partial<Record<ExportKey, SavedMapping>>> {
  const { data } = await supabase().from("import_templates").select("export_key, mapping").eq("company_id", companyId);
  return Object.fromEntries((data ?? []).map((t) => [t.export_key, t.mapping as SavedMapping]));
}
export const saveTemplate = (companyId: string, key: ExportKey, mapping: SavedMapping) => rpc("save_import_template", { p_company: companyId, p_export: key, p_mapping: mapping as unknown as Json });

/** A short-lived link to download the original file. */
export async function originalLink(path: string): Promise<string | null> {
  const { data } = await supabase().storage.from(BUCKET).createSignedUrl(path, 120);
  return data?.signedUrl ?? null;
}
