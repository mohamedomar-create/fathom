/**
 * Sending a file's rows to the database without ever stalling an upload: small batches, two at a time; a batch the database
 * was too busy for is split in half and sent again; when one batch finally fails, every other batch stops at once. A row
 * sent twice is stored once, so an upload that stopped continues with only the rows the database does not hold yet.
 */
export type Range = [number, number];
export interface StageOptions {
  /** Rows per batch at the start (halved on a time-out, down to MIN). */
  size?: number;
  /** Batches in flight at once. */
  parallel?: number;
  /** Only rows whose number falls in these ranges (an upload that continues). */
  missing?: Range[];
  /** Pause before trying a batch again (tests pass an instant one). */
  wait?: (ms: number) => Promise<void>;
}

const MIN = 50;
const TRIES = 4;
/** The database or the connection was busy, not wrong: worth splitting or trying again. */
export const isTransient = (e: unknown) => /statement timeout|canceling statement|lock timeout|57014|55P03|Failed to fetch|NetworkError|network|timed? ?out|50[234]|ECONNRESET/i.test(String((e as Error)?.message ?? e));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The row numbers 1..total not covered by the ranges held (sorted, not overlapping). */
export function missingOf(total: number, held: Range[]): Range[] {
  const out: Range[] = [];
  let next = 1;
  for (const [a, b] of [...held].sort((x, y) => x[0] - y[0])) {
    if (a > next) out.push([next, Math.min(a - 1, total)]);
    next = Math.max(next, b + 1);
    if (next > total) break;
  }
  if (next <= total) out.push([next, total]);
  return out;
}

export async function stageRows<T extends { n: number }>(rows: T[], send: (batch: T[]) => Promise<unknown>, onSent: (sent: number) => void, opts: StageOptions = {}): Promise<void> {
  const size = opts.size ?? 500, parallel = opts.parallel ?? 2, wait = opts.wait ?? sleep;
  const todo = opts.missing ? rows.filter((r) => opts.missing!.some(([a, b]) => r.n >= a && r.n <= b)) : rows;
  const queue: T[][] = [];
  for (let i = 0; i < todo.length; i += size) queue.push(todo.slice(i, i + size));
  let sent = 0;
  let failed: { error: unknown } | null = null;
  // One batch, tried until it is in, split, or fails for good (then every lane stops).
  const deliver = async (batch: T[]) => {
    for (let k = 0; !failed; k++) {
      try {
        await send(batch);
        sent += batch.length;
        onSent(sent);
        return;
      } catch (e) {
        if (failed) return;
        if (isTransient(e) && batch.length > MIN) {
          // Too much for the database at once: the two halves go next, in order.
          const half = Math.ceil(batch.length / 2);
          queue.unshift(batch.slice(0, half), batch.slice(half));
          await wait(500);
          return;
        }
        if (!isTransient(e) || k >= TRIES - 1) { failed = { error: e }; return; }
        await wait(1000 * 2 ** k);
      }
    }
  };
  const lane = async () => { while (!failed && queue.length) await deliver(queue.shift()!); };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(parallel, queue.length)) }, lane));
  if (failed) throw (failed as { error: unknown }).error;
}
