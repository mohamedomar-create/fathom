import { ChunkStopped, orThrow, sendChunks, type ChunkOptions } from "@/lib/chunks";

type Fail = { ok: false; error: string };
export interface StagedSave<T> {
  open: () => Promise<{ ok: true; batch: string; staged: boolean } | Fail>;
  add: (batch: string, part: T[], last: boolean, staged: boolean) => Promise<{ ok: true; saved: number } | Fail>;
  finish: (batch: string) => Promise<{ ok: true; saved: number; sent: number } | Fail>;
}

/**
 * One staged save (migration 0035): open, send the lines in chunks, then finish, which replaces the months in one step.
 * A refused chunk stops the save before the finish, so the live months stay exactly as they were. On a database without
 * staging, `staged` is false and the lines go straight in, as before. `finishEmpty` runs the open and finish even with no
 * lines, to clear the save's months (a source whose new upload has nothing for them).
 */
export async function saveStaged<T>(rows: T[], s: StagedSave<T>, opts: { finishEmpty?: boolean; onProgress?: ChunkOptions["onProgress"]; chunk?: ChunkOptions } = {}): Promise<{ ok: true; saved: number } | Fail> {
  if (!rows.length && !opts.finishEmpty) return { ok: true, saved: 0 };
  const open = await s.open();
  if (!open.ok) return open;
  let saved = 0;
  try {
    // Read the count after the await: chunks run side by side, and `saved += await …` would drop a lane's count.
    await sendChunks(rows, async (part, { last }) => { const r = await orThrow(s.add(open.batch, part, last, open.staged)); saved += r.saved; }, { ...opts.chunk, onProgress: opts.onProgress });
  } catch (e) {
    return { ok: false, error: e instanceof ChunkStopped ? e.message : String(e) };
  }
  if (!open.staged) return { ok: true, saved };
  const f = await s.finish(open.batch);
  if (!f.ok) return f;
  return { ok: true, saved: f.saved };
}
