/**
 * Whether a failed import can be tried again from its staged rows (act_on_import_job 'retry' needs them). A job that failed
 * while preparing was never queued and its rows are deleted (0019); any failed job's rows are cleaned after 30 days (0014).
 */
export function canRetry(j: { status: string; queued_at: string | null; updated_at: string }, now: number): boolean {
  return j.status === "failed" && !!j.queued_at && now - new Date(j.updated_at).getTime() < 30 * 86_400_000;
}
