// The days an import covered, for counting postings entered after it into those days (back-dated postings).

/**
 * An Odoo sync covered up to the day it ran; an upload its cut-off, else its part-month day, else the end of its last month.
 * at: when the import ran (ISO time).
 */
export function sinceOf(at: string, report: unknown): { at: string; through: string } | undefined {
  const r = (report ?? {}) as { kind?: string; cutoff?: string; asOf?: string; periods?: string[] };
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (r.kind === "odoo") return { at, through: at.slice(0, 10) };
  const last = [...(Array.isArray(r.periods) ? r.periods : [])].sort().pop();
  const end = last ? `${last}-${String(new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5)), 0)).getUTCDate()).padStart(2, "0")}` : null;
  const through = r.cutoff && day.test(r.cutoff) ? r.cutoff : r.asOf && day.test(r.asOf) ? r.asOf : end;
  return through ? { at, through } : undefined;
}
