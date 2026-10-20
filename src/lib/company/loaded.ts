// What a page knows about a module's figures, so a failed read is never shown as "no sales" or "upload your data":
//  ready   — the latest figures;
//  empty   — the database answered and holds no records for this module;
//  pending — newer figures are being added up after a change (data, when present, is the previous build);
//  stale   — the latest could not be read; data is the last good copy, from builtAt;
//  failed  — nothing could be read. data is the module's empty value only so code that sums it never breaks; pages must
//            check the status first.
export type LoadStatus = "ready" | "empty" | "pending" | "stale" | "failed";

export interface Loaded<T> {
  status: LoadStatus;
  data: T;
  /** When the figures shown were added up (kept summaries), if known. */
  builtAt: string | null;
  /** A short reference that the server log carries too (failed and stale only). */
  ref?: string;
  /** The SQL or HTTP code behind a failure, for support (never shown on its own). */
  code?: string;
}

/** Figures that can be shown as they are (possibly with a note): the latest, a previous build, or none at all. */
export const hasFigures = (l: Pick<Loaded<unknown>, "status">) => l.status === "ready" || l.status === "stale" || l.status === "pending";
/** The module answered "nothing recorded": the only state in which a page may invite an upload. */
export const isEmpty = (l: Pick<Loaded<unknown>, "status">) => l.status === "empty";
/** Nothing trustworthy to show: checks that depend on the module must say "couldn't be checked", not "missing". */
export const unknownState = (l: Pick<Loaded<unknown>, "status" | "data">, empty: (d: unknown) => boolean) =>
  l.status === "failed" || (l.status === "pending" && empty(l.data));

export const loaded = <T>(status: LoadStatus, data: T, builtAt: string | null = null, extra: { ref?: string; code?: string } = {}): Loaded<T> => ({ status, data, builtAt, ...extra });
