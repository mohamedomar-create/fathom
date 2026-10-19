/**
 * Every save goes through here: small chunks, a few at a time; a chunk the database was too busy for is split in half
 * and sent again; a dropped connection is tried again; the last chunk goes alone once every other one is in (that is
 * when the server finishes the save). A real refusal stops everything at once and says what is still missing, so the
 * save continues with only those items.
 */
import { isTransient } from "@/lib/imports/stage";

export interface ChunkOptions {
  /** Items per chunk at the start (halved when the database is too busy, down to minSize). */
  size?: number;
  minSize?: number;
  /** Chunks in flight at once (the last chunk always goes alone, after the others). */
  parallel?: number;
  /** Items delivered so far, in order of arrival. */
  onProgress?: (done: number, total: number) => void;
  /** Pause before trying again (tests pass an instant one). */
  wait?: (ms: number) => Promise<void>;
}

/** The save stopped at a refusal: `sent` items arrived, `remaining` did not (pass them to continue). */
export class ChunkStopped<T = unknown> extends Error {
  constructor(message: string, readonly sent: number, readonly remaining: T[]) { super(message); }
}

const TRIES = 4;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** A server action's "busy" answer, or the database's own time-out text: worth splitting or trying again. */
export const isBusy = (e: unknown) => isTransient(e) || /database was busy|try again in a moment/i.test(String((e as Error)?.message ?? e));

export async function sendChunks<T>(items: T[], send: (chunk: T[], at: { last: boolean }) => Promise<unknown>, opts: ChunkOptions = {}): Promise<void> {
  if (!items.length) return;
  const size = Math.max(1, opts.size ?? 1000), min = Math.max(1, opts.minSize ?? 50), parallel = Math.max(1, opts.parallel ?? 2), wait = opts.wait ?? sleep;
  const idx = items.map((_, i) => i);
  const queue: number[][] = [];
  for (let i = 0; i < idx.length; i += size) queue.push(idx.slice(i, i + size));
  let lastChunk: number[] | null = queue.pop()!;
  const done = new Set<number>();
  let failed: unknown = null;
  const deliver = async (chunk: number[], last: boolean): Promise<void> => {
    for (let k = 0; failed === null; k++) {
      try {
        await send(chunk.map((i) => items[i]), { last });
        chunk.forEach((i) => done.add(i));
        opts.onProgress?.(done.size, items.length);
        return;
      } catch (e) {
        if (failed !== null) return;
        // Too much at once: the halves go next (the last chunk's first half joins the others, its second half stays last).
        if (isBusy(e) && chunk.length > min) {
          const half = Math.ceil(chunk.length / 2);
          if (last) { queue.unshift(chunk.slice(0, half)); lastChunk = chunk.slice(half); return; }
          queue.unshift(chunk.slice(0, half), chunk.slice(half));
          await wait(300);
          return;
        }
        if (!isBusy(e) || k >= TRIES - 1) { failed = e; return; }
        await wait(800 * 2 ** k);
      }
    }
  };
  const lane = async () => { while (failed === null && queue.length) await deliver(queue.shift()!, false); };
  // The others first, then the last one alone; a last chunk split in half sends its first half with the others again.
  while (failed === null && lastChunk) {
    await Promise.all(Array.from({ length: Math.min(parallel, Math.max(1, queue.length)) }, lane));
    if (failed !== null) break;
    const l: number[] = lastChunk;
    lastChunk = null;
    await deliver(l, true);
  }
  if (failed !== null) {
    const msg = (failed as Error)?.message ?? String(failed);
    throw new ChunkStopped(msg, done.size, idx.filter((i) => !done.has(i)).map((i) => items[i]));
  }
}

/** A server action's `{ ok: false, error }` answer as a thrown error, so the chunk engine can split or retry it. */
export async function orThrow<R extends { ok: boolean }>(p: Promise<R>): Promise<Extract<R, { ok: true }>> {
  const r = await p;
  if (!r.ok) throw new Error((r as { error?: string }).error ?? "Something went wrong.");
  return r as Extract<R, { ok: true }>;
}
