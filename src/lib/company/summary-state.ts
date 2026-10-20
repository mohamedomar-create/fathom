// Turns what summary_state (migration 0032) answered into a page's state. Pure, so every case is unit-tested.
import { loaded, type Loaded } from "./loaded";

export interface StateRow { status?: string; summary?: unknown; same?: boolean; built_at?: string | null; built_seq?: number | null; error?: string | null }
export interface Held<T> { seq: number | null; builtAt: string | null; data: T }

export interface Resolved<T> { state: Loaded<T>; keep: Held<T> | null }

export function fromStateRow<T>(row: StateRow | null, held: Held<T> | null, parse: (raw: unknown) => T, empty: T, isEmpty: (d: T) => boolean, ref: string): Resolved<T> {
  const o = row ?? {};
  const builtAt = o.built_at ?? null;
  const seq = typeof o.built_seq === "number" ? o.built_seq : null;
  // The figures in hand: unchanged (the caller held this build), newly sent, or none.
  let data: T | null = null;
  let keep: Held<T> | null = null;
  if (o.same && held) data = held.data;
  else if (o.summary != null) { data = parse(o.summary); keep = { seq, builtAt, data }; }
  const code = o.error ? o.error.split(" ")[0] : undefined;
  switch (o.status) {
    case "empty": return { state: loaded("empty", empty), keep: null };
    case "ready":
      if (data == null) return { state: loaded("pending", empty, builtAt), keep };
      return { state: loaded(isEmpty(data) ? "empty" : "ready", data, builtAt), keep };
    case "pending": return { state: loaded("pending", data ?? empty, data ? builtAt : null), keep };
    case "failed":
      return data != null
        ? { state: loaded("stale", data, builtAt, { ref, code }), keep }
        : { state: loaded("failed", empty, null, { ref, code }), keep: null };
    default:
      // An answer this app does not understand is not "no records".
      return { state: loaded("failed", empty, null, { ref, code: "UNKNOWN_STATE" }), keep: null };
  }
}

/** The read failed: the last good copy, marked as not the latest, or a failure. */
export function afterError<T>(held: Held<T> | null, empty: T, ref: string, code?: string): Loaded<T> {
  return held ? loaded("stale", held.data, held.builtAt, { ref, code }) : loaded("failed", empty, null, { ref, code });
}
