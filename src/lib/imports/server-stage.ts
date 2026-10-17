import { parseFiles } from "./prepare";
import { isTransient, missingOf, stageRows, type Range } from "./stage";
import type { ExportKey, SavedMapping } from "@/lib/ingest/odoo-templates";

/**
 * A job's rows read and sent by the server, so the page can be closed once the original files are uploaded. The files
 * are read from storage with the same readers as the browser (same rows, same numbers), and only the rows the database
 * does not hold yet are sent: a run that was cut short is simply run again.
 */
export interface StageJob {
  id: string;
  status: string;
  options: { rentalLocation?: string | null; asOf?: string; timeZone?: string | null };
  files: { id: string; filename: string; export_key: string; storage_path: string; stored: boolean }[];
}
/** What the server needs from the database and storage (the signed-in person's own access). */
export interface StageDb {
  job: (id: string) => Promise<StageJob | null>;
  download: (path: string) => Promise<ArrayBuffer>;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
}

/** Reads the job's stored files (quick to fail: a missing file or an unreadable one is known before anything is sent). */
export async function readJobOnServer(db: StageDb, jobId: string, mappings: Record<string, SavedMapping | undefined>) {
  const job = await db.job(jobId);
  if (!job || job.status !== "preparing") throw new Error("This import is no longer open.");
  if (!job.files.length || job.files.some((f) => !f.stored)) throw new Error("NOT_STORED: the original files are not all uploaded yet.");
  const files = await Promise.all(job.files.map(async (f) => ({ name: f.filename, data: await db.download(f.storage_path), export: f.export_key as ExportKey, mapping: mappings[f.id] })));
  const parsed = await parseFiles(files, { rentalLocation: job.options.rentalLocation ?? null, asOf: job.options.asOf ?? "", timeZone: job.options.timeZone ?? null });
  return { job, parsed };
}

/**
 * A call tried again when the connection, not the database, failed: after reading the files for a few seconds the
 * server's idle connection may have been closed, and the first call on it fails ("fetch failed").
 */
async function again<T>(f: () => Promise<T>, wait: (ms: number) => Promise<void>, tries = 4): Promise<T> {
  for (let k = 0; ; k++) {
    try { return await f(); } catch (e) {
      if (k >= tries - 1 || !isTransient(e)) throw e;
      await wait(500 * 2 ** k);
    }
  }
}

export async function stageJobOnServer(db: StageDb, jobId: string, mappings: Record<string, SavedMapping | undefined>, read?: Awaited<ReturnType<typeof readJobOnServer>>, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<{ files: number; rows: number; sent: number }> {
  const { job, parsed } = read ?? await readJobOnServer(db, jobId, mappings);
  const call = (fn: string, args: Record<string, unknown>) => again(() => db.rpc(fn, args), wait);
  let rows = 0, sent = 0;
  for (const [i, f] of job.files.entries()) {
    const records = parsed.files[i].records;
    rows += records.length;
    const held = ((await call("import_held", { p_file: f.id })) ?? []) as Range[];
    const missing = missingOf(records.reduce((m, r) => Math.max(m, r.n), 0), held);
    if (!missing.length) continue;
    await stageRows(records, (b) => db.rpc("stage_import_rows", { p_file: f.id, p_rows: b }), () => undefined, { missing, wait });
    sent += records.filter((r) => missing.some(([a, b]) => r.n >= a && r.n <= b)).length;
  }
  await call("queue_import_job", { p_job: jobId, p_totals: Object.fromEntries(job.files.map((f, i) => [f.id, parsed.files[i].records.length])) }).catch((e) => {
    // Already queued: by an earlier try whose answer was lost, or by the page.
    if (!/NOT_PREPARING/.test(String((e as Error)?.message))) throw e;
  });
  return { files: job.files.length, rows, sent };
}
