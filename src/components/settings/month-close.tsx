"use client";
import { Lock, LockOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { setMonthClosed } from "@/app/company/[id]/settings/close-actions";
import { problemsToClose } from "@/lib/company/close";
import { addMonths } from "@/lib/engine";
import { useT } from "@/lib/i18n/use-t";

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
  const T = useT();
  const k = T.d.setx.close;
  const mlabel = T.ml;
  const [month, setMonth] = useState(candidates[0] ?? "");
  const [reopen, setReopen] = useState(closedMonths[closedMonths.length - 1] ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const problems = month ? problemsToClose(checks, closedThrough, month) : [];
  const run = (m: string, close: boolean) => async () => {
    const r = await setMonthClosed(companyId, m, close);
    if (!r.ok) return r.error;
    setMsg(close ? k.closedMsg(mlabel(r.closedThrough)) : k.reopenedMsg(mlabel(m), mlabel(r.closedThrough)));
    router.refresh();
  };
  return (
    <div className="max-w-2xl space-y-6 text-sm">
      <div className="flex items-center gap-3 rounded-lg border border-line p-4" data-testid="close-status">
        {closedThrough ? <Lock className="h-5 w-5 text-brand-d" /> : <LockOpen className="h-5 w-5 text-mute" />}
        <div>
          <div className="font-medium">{closedThrough ? k.closedThrough(mlabel(closedThrough)) : k.noneClosed}</div>
          <div className="text-mute">{k.statusNote}</div>
        </div>
      </div>
      {msg && <p className="rounded bg-green-bg px-3 py-2 text-green-d" role="status" data-testid="close-msg">{msg}</p>}
      {!canClose && <p className="rounded bg-band px-3 py-2 text-mute" data-testid="close-readonly">{k.onlyAdmin}</p>}

      <section className="rounded-lg border border-line p-4">
        <h2 className="mb-2 font-medium">{k.closeTitle}</h2>
        {candidates.length === 0 ? <p className="text-mute">{k.noFull(closedThrough ? mlabel(closedThrough) : null)}</p> : (
          <>
            <label className="flex flex-wrap items-center gap-2">{k.closeThrough}
              <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border border-line px-2 py-1" data-testid="close-month">
                {candidates.map((p) => <option key={p} value={p}>{mlabel(p)}</option>)}
              </select>
            </label>
            {closedThrough && month > addMonths(closedThrough, 1) && <p className="mt-2 text-mute">{k.everyMonth(mlabel(addMonths(closedThrough, 1)), mlabel(month))}</p>}
            <div className="mt-3" data-testid="close-checklist">
              {problems.length === 0
                ? <p className="text-green-d">{k.checksOk}</p>
                : <><p className="text-red">{k.fixFirst}</p><ul className="mt-1 list-disc ps-5">{problems.slice(0, 8).map((c, i) => <li key={i}>{c.period ? `${mlabel(c.period)}: ` : ""}{c.title}</li>)}</ul></>}
            </div>
            {canClose && (
              <div className="mt-4">
                <ConfirmDialog reauth title={k.dialogTitle(mlabel(month))} confirmLabel={k.closeBtn} onConfirm={run(month, true)} testId="close-dialog"
                  trigger={<button disabled={problems.length > 0} className="rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50" data-testid="close-go">{k.closeGo(mlabel(month))}</button>}>
                  {k.dialogBody}
                </ConfirmDialog>
              </div>
            )}
          </>
        )}
      </section>

      {closedMonths.length > 0 && canClose && (
        <section className="rounded-lg border border-line p-4">
          <h2 className="mb-2 font-medium">{k.reopenTitle}</h2>
          <label className="flex flex-wrap items-center gap-2">{k.reopenFrom}
            <select value={reopen} onChange={(e) => setReopen(e.target.value)} className="rounded border border-line px-2 py-1" data-testid="reopen-month">
              {[...closedMonths].reverse().map((p) => <option key={p} value={p}>{mlabel(p)}</option>)}
            </select>
          </label>
          <p className="mt-2 text-mute">{k.laterOpen}</p>
          <div className="mt-3">
            <ConfirmDialog reauth title={k.reopenDialog(mlabel(reopen))} confirmLabel={k.reopenBtn} onConfirm={run(reopen, false)} testId="reopen-dialog"
              trigger={<button className="rounded border border-line px-4 py-2 font-medium" data-testid="reopen-go">{k.reopenGo(mlabel(reopen))}</button>}>
              {k.reopenBody}
            </ConfirmDialog>
          </div>
        </section>
      )}

      {log.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">{k.history}</h2>
          <ul className="space-y-1 text-mute" data-testid="close-log">
            {log.map((l, i) => <li key={i}>{new Date(l.at).toLocaleString(T.lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}: {l.action === "close_month" ? k.logClosed(mlabel(l.month)) : k.logReopened(mlabel(l.month))}</li>)}
          </ul>
        </section>
      )}
    </div>
  );
}
