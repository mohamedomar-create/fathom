"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { money, pct, type AgencyLine } from "@/lib/engine";
import { mergeStatementLines, readAgencyStatement, type AgencyStatement } from "@/lib/ingest/agency-statement";
import { readInWorker } from "@/lib/imports/worker-client";
import type { Grid } from "@/lib/ingest/extract";
import { Preflight } from "@/components/preflight/preflight";
import { PreflightSummary } from "@/components/preflight/summary";
import type { PreflightRun } from "@/lib/preflight";
import { resolveEndUsers, type EndUserData } from "@/lib/company/end-users-parse";
import { useCompany } from "@/lib/company/context";
import { removeAgencyStatement, saveAgencyStatement } from "@/app/company/[id]/data/actions";
import { useT } from "@/lib/i18n/use-t";

const lineKey = (l: AgencyLine) => `${l.day}|${l.value}|${l.hospital}`;
/** Share of a sheet's lines that another sheet already has (same day, value and hospital): a copy or a subset of it. */
function overlap(a: AgencyStatement, b: AgencyStatement) {
  const keys = new Set(b.lines.map(lineKey));
  return a.lines.length ? a.lines.filter((l) => keys.has(lineKey(l))).length / a.lines.length : 0;
}

/**
 * Upload a buying agency's statement (the UPA sheet): it is read and matched to Odoo's agency invoices on the page first,
 * so the person sees how much it places, what it leaves, and that sales and receivables do not change; then saved.
 */
export function AgencyStatementUpload({ data, booksStart }: { data: EndUserData; booksStart: string | null }) {
  const c = useCompany();
  const t = useT().d.dat.ag;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [reads, setReads] = useState<AgencyStatement[] | null>(null);
  const [filename, setFilename] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [pf, setPf] = useState<{ name: string; grids: Grid[] } | null>(null);
  const [pfRun, setPfRun] = useState<PreflightRun | null>(null);
  const cur = c.settings.currency;
  const now = useMemo(() => resolveEndUsers(data), [data]);

  const { lines, merged } = useMemo(() => mergeStatementLines(reads ?? [], picked), [reads, picked]);
  const next = useMemo(() => (lines.length ? resolveEndUsers(data, lines) : null), [data, lines]);
  const largest = reads?.slice().sort((a, b) => b.lines.length - a.lines.length)[0];

  const read = async (f: File) => {
    setMsg(null); setReads(null); setPfRun(null);
    try {
      setPf({ name: f.name, grids: await readInWorker([{ name: f.name, data: await f.arrayBuffer() }]) });
    } catch (e) {
      setMsg((e as Error).message || t.unreadable);
    }
  };
  // After preflight: the statement is read from the cleaned copy only.
  const afterPreflight = (run: PreflightRun) => {
    const name = pf?.name ?? "";
    setPf(null); setPfRun(run);
    try {
      const found = run.cleaned.forImport.map((g) => readAgencyStatement(g, { booksStart })).filter((r): r is AgencyStatement => Boolean(r && r.lines.length));
      setFilename(name);
      setReads(found);
      const big = found.slice().sort((a, b) => b.lines.length - a.lines.length)[0];
      setPicked(new Set(big ? [big.sheet] : []));
      if (!found.length) setMsg(t.noSheet);
    } catch (e) {
      setMsg((e as Error).message || t.unreadable);
    }
  };
  const save = () => start(async () => {
    const chosen = (reads ?? []).filter((r) => picked.has(r.sheet));
    const r = await saveAgencyStatement(c.id, { filename, sheets: chosen.map((x) => x.sheet), report: { lines: lines.length, total: lines.reduce((s, l) => s + l.value, 0), issues: chosen.flatMap((x) => x.issues.map((i) => `${x.sheet}: ${i}`)).slice(0, 50) }, lines });
    setMsg(r.ok ? t.saved(r.saved) : r.error);
    if (r.ok) { setReads(null); router.refresh(); }
  });
  const remove = () => start(async () => {
    const r = await removeAgencyStatement(c.id);
    setMsg(r.ok ? t.removed : r.error);
    if (r.ok) router.refresh();
  });
  const cov = (x: ReturnType<typeof resolveEndUsers> | null) => (x?.analysis.coverage === null || !x ? "–" : pct(x.analysis.coverage * 100, 1));

  return (
    <section data-testid="agency-statement">
      <h2 className="mb-1 text-xl font-light">{t.title}</h2>
      <p className="mb-3 max-w-3xl text-[13px] text-mute">
        {t.intro}
      </p>
      {data.statementFile && (
        <p className="mb-3 text-[13.5px]" data-testid="statement-file">
          {t.loaded} <b>{data.statementFile.filename}</b> ({data.statementFile.sheets.join(", ")}){t.loadedTail(data.statement.length.toLocaleString("en-US"), cov(now))}
          {!c.readOnly && <button className="ms-3 text-xs underline" disabled={pending} onClick={remove}>{t.remove}</button>}
        </p>
      )}
      {msg && <p className="mb-3 rounded border border-line bg-panel p-2 text-[13.5px]" role="status">{msg}</p>}
      {!c.readOnly && <input type="file" accept=".xlsx,.xls,.csv" aria-label={t.fileAria} onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); e.target.value = ""; }} className="text-sm" />}
      {pf && <div className="mt-4 max-w-4xl"><Preflight module="agency" moduleLabel={t.module} grids={pf.grids} fileName={pf.name} onReady={({ run }) => afterPreflight(run)} /></div>}
      {reads && reads.length > 0 && (
        <div className="mt-4 space-y-3" data-testid="statement-preview">
          <PreflightSummary run={pfRun} company={c.name} moduleLabel={t.module} />
          <table className="w-full max-w-4xl text-[13px]">
            <thead><tr className="label"><th className="py-1 text-start">{t.use}</th><th className="text-start">{t.sheet}</th><th className="text-end">{t.lines}</th><th className="text-end">{t.value}</th><th className="text-start ps-4">{t.notes}</th></tr></thead>
            <tbody>
              {reads.map((r) => {
                const copy = largest && r !== largest && overlap(r, largest) >= 0.5 ? t.copy(Math.round(overlap(r, largest) * 100), largest.sheet) : "";
                return (
                  <tr key={r.sheet} className="border-t border-line align-top">
                    <td className="py-1"><input type="checkbox" aria-label={t.useAria(r.sheet)} checked={picked.has(r.sheet)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(r.sheet); else n.delete(r.sheet); return n; })} /></td>
                    <td>{r.sheet}</td>
                    <td className="num text-end">{r.lines.length}</td>
                    <td className="num text-end">{money(r.total, cur, true)}</td>
                    <td className="ps-4 text-mute">{[copy, r.beforeStart.lines ? t.before(r.beforeStart.lines) : "", ...r.issues].filter(Boolean).join(" · ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {next && (
            <div className="max-w-4xl rounded border border-line p-3 text-[13.5px]" data-testid="statement-effect">
              <p>{t.placed} <b>{cov(now)}</b> {t.now} → <b data-testid="statement-coverage">{cov(next)}</b> {t.withThis(next.match.byDoc.size)}</p>
              <p>{t.stay} <b>{money(next.analysis.total, cur)}</b> {t.stayTail}</p>
              {merged > 0 && <p className="text-mute" data-testid="statement-merged">{t.merged(merged)}</p>}
              <p className="text-mute">{t.unmatched(next.match.unmatchedLines.length, money(next.match.unmatchedLines.reduce((s, l) => s + l.value, 0), cur, true), next.match.unmatchedInvoices.length)}</p>
              <button className="mt-2 rounded bg-brand-d px-3 py-1 text-sm text-white" disabled={pending || !lines.length} onClick={save}>{t.save}</button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
