/**
 * Month close (0043): the books are closed up to and including `closedThrough` ("YYYY-MM"). Nothing in a closed month is
 * saved again; the database refuses it whatever the path, and the app leaves those months out first and says so.
 */
export const isClosed = (period: string, closedThrough: string | null | undefined): boolean => !!closedThrough && period <= closedThrough;

/** Lines in open months, and how many were left out per closed month. */
export function openLines<T extends { period: string }>(lines: T[], closedThrough: string | null | undefined): { kept: T[]; skipped: Record<string, number> } {
  if (!closedThrough) return { kept: lines, skipped: {} };
  const kept: T[] = [], skipped: Record<string, number> = {};
  for (const l of lines) if (isClosed(l.period, closedThrough)) skipped[l.period] = (skipped[l.period] ?? 0) + 1; else kept.push(l);
  return { kept, skipped };
}

export const openPeriods = (periods: string[], closedThrough: string | null | undefined): string[] => periods.filter((p) => !isClosed(p, closedThrough));

/**
 * The months that can be closed next: every loaded month after the closed one, oldest first, leaving out a month the
 * books only partly cover (asOf before its last day).
 */
export function closeCandidates(months: string[], closedThrough: string | null | undefined, asOf: string | null | undefined): string[] {
  const part = asOf && asOf.slice(0, 7);
  const lastDay = (p: string) => new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7), 0)).toISOString().slice(0, 10);
  return [...new Set(months)].sort().filter((p) => !isClosed(p, closedThrough) && !(part === p && asOf! < lastDay(p)));
}

/** The problems a person must fix (or accept) before closing through `month`: blocking, not accepted, in a month being closed. */
export function problemsToClose<C extends { severity: string; period?: string; accepted?: boolean }>(checks: C[], closedThrough: string | null | undefined, month: string): C[] {
  return checks.filter((c) => c.severity === "block" && !c.accepted && !!c.period && !isClosed(c.period, closedThrough) && c.period <= month);
}
