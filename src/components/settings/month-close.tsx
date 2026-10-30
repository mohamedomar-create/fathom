"use client";
import { Lock, LockOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { setMonthClosed } from "@/app/company/[id]/settings/close-actions";
import { problemsToClose } from "@/lib/company/close";
import { addMonths, mlabel } from "@/lib/engine";

interface CheckRow { id: string; severity: string; period?: string; title: string; accepted: boolean }

/**
 * Month close: the books are closed up to a month, after which nothing in those months changes (uploads and syncs skip
 * them, the database refuses any change). Closing needs the months' blocking checks fixed or accepted first.
 */
export function MonthClose({ companyId, closedThrough, candidates, closedMonths, canClose, checks, log }: {
  companyId: string; closedThrough: string | null; candidates: string[]; closedMonths: string[]; canClose: boolean; checks: CheckRow[];
  log: { action: "close_month" | "reopen_month"; month: string; at: string }[];
}) {
  const router = useRouter();
  const [month, setMonth] = useState(candidates[0] ?? "");
  const [reopen, setReopen] = useState(closedMonths[closedMonths.length - 1] ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const problems = month ? problemsToClose(checks, closedThrough, month) : [];
  const run = (m: string, close: boolean) => async () => {
    const r = await setMonthClosed(companyId, m, close);
    if (!r.ok) return r.error;
    setMsg(close ? `The books are closed through ${mlabel(r.closedThrough)}.` : `${mlabel(m)} is open again; the books are closed through ${mlabel(r.closedThrough)}.`);
    router.refresh();
  };
  return (
    <div className="max-w-2xl space-y-6 text-sm">
      <div className="flex items-center gap-3 rounded-lg border border-line p-4" data-testid="close-status">
        {closedThrough ? <Lock className="h-5 w-5 text-brand-d" /> : <LockOpen className="h-5 w-5 text-mute" />}
        <div>
          <div className="font-medium">{closedThrough ? `Closed through ${mlabel(closedThrough)}` : "No month is closed yet"}</div>
          <div className="text-mute">A closed month&apos;s figures can&apos;t change: uploads and Odoo syncs leave it out, and reports for it stay as they are. Reopen it to change it.</div>
        </div>
      </div>
      {msg && <p className="rounded bg-green-bg px-3 py-2 text-green-d" role="status" data-testid="close-msg">{msg}</p>}
      {!canClose && <p className="rounded bg-band px-3 py-2 text-mute" data-testid="close-readonly">Only the owner or an admin of the organisation closes and reopens months.</p>}

      <section className="rounded-lg border border-line p-4">
        <h2 className="mb-2 font-medium">Close a month</h2>
        {candidates.length === 0 ? <p className="text-mute">There is no full month after {closedThrough ? mlabel(closedThrough) : "the books start"} to close yet.</p> : (
          <>
            <label className="flex flex-wrap items-center gap-2">Close the books through
              <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-line px-2 py-1" data-testid="close-month">
                {candidates.map((p) => <option key={p} value={p}>{mlabel(p)}</option>)}
              </select>
            </label>
            {closedThrough && month > addMonths(closedThrough, 1) && <p className="mt-2 text-mute">Every month from {mlabel(addMonths(closedThrough, 1))} to {mlabel(month)} is closed with it.</p>}
            <div className="mt-3" data-testid="close-checklist">
              {problems.length === 0
                ? <p className="text-green-d">Checks: nothing open in these months (every balance check passes or was accepted at upload).</p>
                : <><p className="text-red">Fix these first, or accept them on the upload&apos;s check step:</p><ul className="mt-1 list-disc ps-5">{problems.slice(0, 8).map((c, i) => <li key={i}>{c.period ? `${mlabel(c.period)}: ` : ""}{c.title}</li>)}</ul></>}
            </div>
            {canClose && (
              <div className="mt-4">
                <ConfirmDialog reauth title={`Close the books through ${mlabel(month)}?`} confirmLabel="Close" onConfirm={run(month, true)} testId="close-dialog"
                  trigger={<button disabled={problems.length > 0} className="rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50" data-testid="close-go">Close {mlabel(month)}</button>}>
                  Uploads, Odoo syncs and edits will leave these months as they are. You can reopen a month here; each close and reopen is recorded.
                </ConfirmDialog>
              </div>
            )}
          </>
        )}
      </section>

      {closedMonths.length > 0 && canClose && (
        <section className="rounded-lg border border-line p-4">
          <h2 className="mb-2 font-medium">Reopen a month</h2>
          <label className="flex flex-wrap items-center gap-2">Reopen from
            <select value={reopen} onChange={(e) => setReopen(e.target.value)} className="rounded border border-line px-2 py-1" data-testid="reopen-month">
              {[...closedMonths].reverse().map((p) => <option key={p} value={p}>{mlabel(p)}</option>)}
            </select>
          </label>
          <p className="mt-2 text-mute">Every later month opens with it.</p>
          <div className="mt-3">
            <ConfirmDialog reauth title={`Reopen ${mlabel(reopen)}?`} confirmLabel="Reopen" onConfirm={run(reopen, false)} testId="reopen-dialog"
              trigger={<button className="rounded border border-line px-4 py-2 font-medium" data-testid="reopen-go">Reopen {mlabel(reopen)}</button>}>
              Its figures can change again until it is closed once more. This is recorded.
            </ConfirmDialog>
          </div>
        </section>
      )}

      {log.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">History</h2>
          <ul className="space-y-1 text-mute" data-testid="close-log">
            {log.map((l, i) => <li key={i}>{new Date(l.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}: {l.action === "close_month" ? `closed through ${mlabel(l.month)}` : `reopened from ${mlabel(l.month)}`}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
