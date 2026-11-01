"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Download, Loader2, XCircle } from "lucide-react";
import { actOnJob, importError, isActiveHere, jobErrors, listJobs, originalLink, pendingJob, type JobView } from "@/lib/imports/jobs";
import { ODOO_TEMPLATES, type ExportKey } from "@/lib/ingest/odoo-templates";
import { cn } from "@/lib/cn";
import { canRetry } from "@/lib/imports/retry";
import { useT } from "@/lib/i18n/use-t";

/**
 * Recent imports of a company, read straight from the database every few seconds while one is running: where each one is
 * (uploading and reading → waiting → checking → saving → saved), its counts, its messages and the rows it could not read,
 * with what the person can do next (import the valid rows only, try again, stop, continue an interrupted upload).
 */
const STEPS = ["preparing", "queued", "checking", "saving", "done"] as const;
const ACTIVE = new Set(["preparing", "queued", "checking", "saving"]);
const n = (v: unknown) => Number(v ?? 0).toLocaleString("en-US");
const when = (s: string, ar = false) => new Date(s).toLocaleString(ar ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

export function ImportJobs({ companyId, onContinue, refreshKey = 0, limit = 15 }: { companyId: string; onContinue?: (jobId: string) => void; refreshKey?: number; limit?: number }) {
  const router = useRouter();
  const t = useT().d.dat.jobs;
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const seenDone = useRef<Set<string> | null>(null);
  const load = useCallback(async () => {
    try {
      const js = await listJobs(companyId);
      setJobs(js.slice(0, limit)); setErr(null); setNow(Date.now());
      // A job that finished while the page was open: the pages are read again so they show the new stock.
      const done = js.filter((j) => j.status === "done").map((j) => j.id);
      if (seenDone.current && done.some((id) => !seenDone.current!.has(id))) router.refresh();
      seenDone.current = new Set(done);
    } catch (e) { setErr(importError(e)); }
  }, [companyId, limit, router]);
  const busy = jobs?.some((j) => ACTIVE.has(j.status)) ?? false;
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [refreshKey, load]);
  useEffect(() => {
    const t = setInterval(load, busy ? 2000 : 20000);
    return () => clearInterval(t);
  }, [busy, load]);

  if (err) return <p className="rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert" data-testid="import-jobs-error">{err}</p>;
  if (!jobs) return <p className="flex items-center gap-2 text-[13px] text-mute"><Loader2 className="h-4 w-4 animate-spin" />{t.loading}</p>;
  if (!jobs.length) return null;
  return (
    <section className="max-w-5xl" data-testid="import-jobs">
      <h3 className="mb-2 text-lg font-normal">{t.title}</h3>
      <ul className="space-y-3">{jobs.map((j) => <JobCard key={j.id} j={j} now={now} reload={load} onContinue={onContinue} />)}</ul>
    </section>
  );
}

function JobCard({ j, now, reload, onContinue }: { j: JobView; now: number; reload: () => void; onContinue?: (jobId: string) => void }) {
  const T = useT();
  const t = T.d.dat.jobs;
  const [errors, setErrors] = useState<{ file_id: string; line: number | null; error: string }[] | null>(null);
  const [acting, setActing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const c = (j.counts ?? {}) as Record<string, number>;
  // A preparing job that no page of this browser is sending: interrupted (the page was closed or the connection dropped).
  const interrupted = j.status === "preparing" && !isActiveHere(j.id) && now - new Date(j.updated_at).getTime() > 60_000;
  const canContinue = interrupted && !!pendingJob(j.id) && !!onContinue;
  const at = STEPS.findIndex((k) => k === j.status);
  const act = async (a: "cancel" | "accept" | "retry") => {
    setActing(true); setMsg(null);
    try { await actOnJob(j.id, a); reload(); } catch (e) { setMsg(importError(e)); } finally { setActing(false); }
  };
  const fileName = (id: string) => j.files.find((f) => f.id === id)?.filename ?? "";
  const csv = () => {
    const rows = [t.csvHead, ...(errors ?? []).map((e) => [fileName(e.file_id), String(e.line ?? ""), e.error])];
    const blob = new Blob([rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `import-problems-${j.id.slice(0, 8)}.csv`; a.click();
  };
  const tone = j.status === "done" ? "border-green/50" : j.status === "failed" ? "border-red/50" : j.status === "needs_review" ? "border-amber" : "border-line";
  return (
    <li className={cn("rounded-xl border-2 p-4", tone)} data-testid="import-job" data-status={interrupted ? "interrupted" : j.status}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1.5 font-medium" data-testid="import-job-status">
          {j.status === "done" ? <CheckCircle2 className="h-4 w-4 text-green-d" /> : j.status === "failed" ? <XCircle className="h-4 w-4 text-red" /> : j.status === "needs_review" || interrupted ? <AlertTriangle className="h-4 w-4 text-amber" /> : ACTIVE.has(j.status) ? <Loader2 className="h-4 w-4 animate-spin text-brand" /> : null}
          {interrupted ? t.interrupted : t.label[j.status]}
        </span>
        <span className="text-[13px] text-mute">{t.mode[j.mode]} · {t.started(when(j.created_at, T.lang === "ar"))}</span>
      </div>
      {!["failed", "cancelled", "needs_review"].includes(j.status) && !interrupted && (
        <ol className="mt-2 flex flex-wrap gap-1.5 text-[12px]" aria-label={t.progress}>
          {STEPS.map((k, i) => <li key={k} className={cn("rounded-full px-2 py-0.5", i < at || j.status === "done" ? "bg-brand-d text-white" : i === at ? "bg-ink text-white" : "bg-band text-mute")}>{t.steps[k]}</li>)}
        </ol>
      )}
      <ul className="mt-2 space-y-0.5 text-[13px]">
        {j.files.map((f) => {
          const fc = (f.counts ?? {}) as Record<string, number>;
          return (
            <li key={f.id} className="flex flex-wrap items-center gap-x-2" data-testid="import-job-file">
              <span className="font-medium">{f.filename}</span>
              <span className="text-mute">{ODOO_TEMPLATES[f.export_key as ExportKey]?.title ?? f.kind}</span>
              {f.rows_declared !== null && <span className="text-mute">{t.rows(n(f.rows_declared))}</span>}
              {fc.invalid > 0 && <span className="text-red">{t.problems(n(fc.invalid))}</span>}
              {f.stored && <button type="button" className="inline-flex items-center gap-1 text-mute underline" onClick={async () => { const u = await originalLink(f.storage_path); if (u) window.open(u, "_blank", "noopener"); }}><Download className="h-3 w-3" />{t.original}</button>}
            </li>
          );
        })}
      </ul>
      {c.rows !== undefined && (
        <p className="mt-2 text-[13px]" data-testid="import-job-counts">
          {j.status === "done"
            ? <>{t.done(n(c.added), n(c.replaced), n(c.already))}{c.invalid ? <> · <span className="text-red">{t.leftOut(n(c.invalid), c.invalid === 1)}</span></> : null}</>
            : <>{t.counts(n(c.rows), n(c.new), n(c.changed), n(c.unchanged))}{c.invalid ? <> · <span className="text-red">{t.withProblems(n(c.invalid))}</span></> : null}</>}
        </p>
      )}
      {j.message && <p className={cn("mt-2 rounded px-3 py-2 text-[13px]", j.status === "failed" ? "bg-red-bg text-red" : "bg-amber/10")} data-testid="import-job-message">{j.message.replace(/^[A-Z_]+: /, "")}</p>}
      {interrupted && <p className="mt-2 rounded bg-amber/10 px-3 py-2 text-[13px]">{t.stoppedUpload} {canContinue ? t.chooseSame : t.startAgain}</p>}
      {j.status === "failed" && !canRetry(j, now) && <p className="mt-2 text-[13px] text-mute" data-testid="import-choose-again">{t.noLonger}</p>}
      {msg && <p className="mt-2 rounded bg-red-bg px-3 py-2 text-[13px] text-red" role="alert">{msg}</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
        {(c.invalid > 0 || j.status === "needs_review") && <button type="button" className="rounded border border-line px-3 py-1.5" data-testid="import-show-errors"
          onClick={async () => { if (errors) { setErrors(null); return; } try { setErrors(await jobErrors(j.id)); } catch (e) { setMsg(importError(e)); } }}>{errors ? t.hide : t.show}</button>}
        {j.status === "needs_review" && <button type="button" disabled={acting} className="rounded bg-brand-d px-3 py-1.5 text-white disabled:opacity-40" data-testid="import-accept" onClick={() => act("accept")}>{t.acceptValid}</button>}
        {canRetry(j, now) && <button type="button" disabled={acting} className="rounded bg-brand-d px-3 py-1.5 text-white disabled:opacity-40" data-testid="import-retry" onClick={() => act("retry")}>{t.retry}</button>}
        {canContinue && <button type="button" className="rounded bg-brand-d px-3 py-1.5 text-white" data-testid="import-continue" onClick={() => onContinue!(j.id)}>{t.cont}</button>}
        {(["queued", "needs_review", "failed"].includes(j.status) || interrupted) && <button type="button" disabled={acting} className="rounded border border-line px-3 py-1.5 disabled:opacity-40" data-testid="import-cancel" onClick={() => act("cancel")}>{t.stop}</button>}
      </div>
      {errors && (
        <div className="mt-3" data-testid="import-errors">
          {errors.length === 0 ? <p className="text-[13px] text-mute">{t.noErrors}</p> : <>
            <div className="max-h-72 overflow-auto rounded border border-line">
              <table className="tbl text-[12.5px]"><thead><tr><th className="!text-start">{t.file}</th><th>{t.row}</th><th className="!text-start">{t.problem}</th></tr></thead>
                <tbody>{errors.map((e, k) => <tr key={k}><td className="!text-start">{fileName(e.file_id)}</td><td className="num">{e.line ?? "–"}</td><td className="!text-start">{e.error}</td></tr>)}</tbody></table>
            </div>
            <button type="button" className="mt-2 text-[13px] underline" onClick={csv}>{t.csv}</button>
            {errors.length >= 500 && <span className="ms-2 text-[12px] text-mute">{t.first500}</span>}
          </>}
        </div>
      )}
    </li>
  );
}
