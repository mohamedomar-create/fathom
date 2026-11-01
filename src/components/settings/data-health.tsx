"use client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CheckCircle2, History, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { mlabel } from "@/lib/engine";
import { layerSummary } from "@/lib/company/checks";
import { restoreVersion, type AcceptedItem } from "@/app/company/[id]/settings/actions";
import { cn } from "@/lib/cn";
import { cellRef, type FixRecord } from "@/lib/ingest/trace";
import { CheckList, type PreviewCheck } from "./import-timeline";
import { SourceDrawer, type SourceLine } from "@/components/analysis/source-drawer";
import { useT } from "@/lib/i18n/use-t";
import { monthNames, type Lang } from "@/lib/i18n";

const TRACE: { key: string; label: string; st: "PL" | "BS" }[] = [
  { key: "revenue", label: "Revenue", st: "PL" }, { key: "net_income", label: "Net income", st: "PL" },
  { key: "cash", label: "Cash", st: "BS" }, { key: "ta", label: "Total assets", st: "BS" },
  { key: "tl", label: "Total liabilities", st: "BS" }, { key: "te", label: "Total equity", st: "BS" },
];

export interface MonthSource { importId: string | null; file: string; at: string | null; by: string | null }
export interface HistoryRow {
  id: string; kind: string; action: string; file: string | null; at: string; by: string | null; version: number | null;
  current: boolean; restorable: boolean; mode: string | null; pl: string[]; bs: string[]; accepted: number;
  restoredFrom: number | null; restoredTo: number | null;
  /** Corrections made in the upload's reading box (retyped cells, rows left out). */
  fixes?: FixRecord[];
}

type Status = "ok" | "warn" | "block" | "accepted" | "missing" | "none";
const STATUS: Record<Status, { label: string; cls: string }> = {
  ok: { label: "Checks pass", cls: "bg-green-d text-white" },
  warn: { label: "Warning", cls: "bg-amber text-ink" },
  accepted: { label: "Accepted issue", cls: "bg-[#c9a0dc] text-ink" },
  block: { label: "Check failed", cls: "bg-red text-white" },
  missing: { label: "Missing", cls: "bg-white border border-dashed border-red/60" },
  none: { label: "No data", cls: "bg-white border border-dashed border-line" },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Dates and month labels in the chosen language (Western digits in both). */
function useFmt() {
  const T = useT();
  const ml = T.lang === "ar" ? T.ml : mlabel;
  return {
    T, t: T.d.dat.health, ml,
    fmtDate: (s: string) => new Date(s).toLocaleString(T.lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" }),
    span: (ps: string[]) => (!ps.length ? "–" : ps.length === 1 ? ml(ps[0]) : `${ml(ps[0])} – ${ml(ps[ps.length - 1])}`),
    month: (i: number, lang: Lang) => (lang === "ar" ? monthNames("ar")[i + 1] : MONTHS[i]),
  };
}

export function DataHealth({ companyId, readOnly, justImported, coverage, checks, accepted, sources, history }: {
  companyId: string; readOnly: boolean; justImported: boolean;
  coverage: { range: string[]; pl: string[]; bs: string[] };
  checks: PreviewCheck[]; accepted: AcceptedItem[]; sources: Record<string, MonthSource[]>; history: HistoryRow[];
}) {
  const { T, t, ml, fmtDate, span, month } = useFmt();
  const label = (s: Status) => t.status[s] ?? STATUS[s].label;
  const pl = useMemo(() => new Set(coverage.pl), [coverage.pl]);
  const bs = useMemo(() => new Set(coverage.bs), [coverage.bs]);
  const real = checks.filter((c) => c.severity !== "info");
  const failing = real.filter((c) => c.severity === "block" && !c.accepted);
  const acceptedNow = real.filter((c) => c.accepted);
  const warns = real.filter((c) => c.severity === "warn");
  const [trace, setTrace] = useState<SourceLine | null>(null);
  const [sel, setSel] = useState<string | null>(failing[0]?.period ?? warns[0]?.period ?? coverage.range[coverage.range.length - 1] ?? null);

  const status = (p: string, st: "PL" | "BS"): Status => {
    const set = st === "PL" ? pl : bs;
    if (!set.has(p)) {
      const s = [...set].sort();
      return s.length && p > s[0] && p < s[s.length - 1] ? "missing" : "none";
    }
    const cs = real.filter((c) => c.period === p && (c.statement ?? st) === st);
    if (cs.some((c) => c.severity === "block" && !c.accepted)) return "block";
    if (cs.some((c) => c.accepted)) return "accepted";
    if (cs.length) return "warn";
    return "ok";
  };

  const years = [...new Set(coverage.range.map((p) => p.slice(0, 4)))];
  const general = checks.filter((c) => !c.period);
  const selChecks = sel ? checks.filter((c) => c.period === sel) : [];

  return (
    <div className="space-y-8">
      {justImported && <div className="flex items-center gap-2 rounded-md bg-green-bg px-4 py-3 text-sm" data-testid="import-done"><CheckCircle2 className="h-4 w-4 text-green-d" />{t.saved}</div>}

      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label={t.pl} value={span(coverage.pl)} sub={t.months(coverage.pl.length)} />
        <Tile label={t.bs} value={span(coverage.bs)} sub={t.months(coverage.bs.length)} />
        <Tile label={t.failed} value={String(failing.length)} tone={failing.length ? "bad" : "ok"} sub={failing.length ? t.fixFirst : t.none} testid="failed-count" />
        <Tile label={t.acceptedWarn} value={`${acceptedNow.length} / ${warns.length}`} tone={acceptedNow.length || warns.length ? "warn" : "ok"} sub={t.seeMarked} />
      </div>

      {real.length > 0 && (
        <section data-testid="check-layers">
          <h2 className="mb-1 text-lg font-medium">{t.layers}</h2>
          <p className="mb-3 text-sm text-mute">{t.layersSub}</p>
          <div className="grid gap-2 sm:grid-cols-4">
            {layerSummary(real).map((l) => (
              <div key={l.layer} className="rounded-md border border-line px-3 py-2.5" data-testid={`layer-${l.layer}`}>
                <div className="text-[13px] font-medium">{t.layer[l.layer] ?? l.label}</div>
                <div className={cn("mt-1 text-sm", l.open ? "text-red" : l.warn ? "text-[#7d5600]" : "text-green-d")}>
                  {l.open ? t.open(l.open) : l.warn ? t.toAnswer(l.warn) : t.allClear}{l.accepted ? t.nAccepted(l.accepted) : ""}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!coverage.range.length ? (
        <p className="text-mute">{t.noData} <Link className="text-brand-d underline" href={`/company/${companyId}/data`}>{t.uploadOdoo}</Link>.</p>
      ) : (
        <section>
          <h2 className="mb-1 text-lg font-medium">{t.monthsTitle}</h2>
          <p className="mb-3 text-sm text-mute">{t.clickMonth}</p>
          <div tabIndex={0} className="-mx-1 overflow-x-auto px-1" data-testid="health-calendar">
            <table className="border-separate border-spacing-[3px] text-[11px]">
              <thead><tr><th /><th />{MONTHS.map((m, mi) => <th key={m} className="min-w-10 text-center font-normal text-mute">{month(mi, T.lang)}</th>)}</tr></thead>
              <tbody>
                {years.map((y) => (["PL", "BS"] as const).map((st, i) => (
                  <tr key={y + st}>
                    <td className="pe-2 text-[12px] font-semibold">{i === 0 ? y : ""}</td>
                    <td className="pe-2 text-[11px] text-mute">{st === "PL" ? t.plShort : t.bsShort}</td>
                    {MONTHS.map((_, mi) => {
                      const p = `${y}-${String(mi + 1).padStart(2, "0")}`;
                      const s = status(p, st);
                      return (
                        <td key={p} className="p-0">
                          <button type="button" onClick={() => setSel(p)} title={`${ml(p)} · ${label(s)}`} aria-label={`${ml(p)} ${st === "PL" ? t.plLong : t.bsLong}: ${label(s)}`}
                            className={cn("block h-7 w-full rounded-sm", STATUS[s].cls, sel === p && "ring-2 ring-ink ring-offset-1")} data-status={s} data-period={p} data-st={st} />
                        </td>
                      );
                    })}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
            {(Object.keys(STATUS) as Status[]).map((k) => <span key={k} className="flex items-center gap-1.5"><span className={cn("inline-block h-3 w-3 rounded-sm", STATUS[k].cls)} />{label(k)}</span>)}
          </div>
        </section>
      )}

      {sel && coverage.range.length > 0 && (
        <section className="grid gap-6 lg:grid-cols-[1fr_320px]" data-testid="month-detail">
          <div>
            <h2 className="mb-3 text-lg font-medium">{t.checksFor(ml(sel))}</h2>
            <CheckList checks={selChecks} empty={pl.has(sel) || bs.has(sel) ? t.allPass : t.noMonth} />
            {(pl.has(sel) || bs.has(sel)) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="trace-buttons">
                <span className="text-mute">{t.behind}</span>
                {TRACE.filter((x) => (x.st === "PL" ? pl : bs).has(sel)).map((x) => (
                  <button key={x.key} type="button" onClick={() => setTrace({ key: x.key, label: `${t.trace[x.key] ?? x.label}, ${ml(sel)}`, statement: x.st, periods: [sel] })} className="rounded-full border border-line px-2.5 py-0.5 hover:bg-band">{t.trace[x.key] ?? x.label}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <h2 className="mb-3 text-lg font-medium">{t.source}</h2>
            {(["PL", "BS"] as const).map((st) => {
              const list = sources[`${st}|${sel}`] ?? [];
              return (
                <div key={st} className="mb-3 rounded-md bg-band p-3 text-[13px]">
                  <div className="label mb-1">{st === "PL" ? t.pl : t.bs}</div>
                  {!list.length ? <div className="text-mute">{t.noDataShort}</div> : list.map((s) => (
                    <div key={s.importId ?? "x"}><span className="font-medium">{s.file}</span>{s.at && <span className="text-mute"> · {fmtDate(s.at)}{s.by ? ` · ${s.by}` : ""}</span>}</div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(general.length > 0 || accepted.length > 0) && (
        <section>
          <h2 className="mb-3 text-lg font-medium">{t.acceptedTitle}</h2>
          {accepted.length ? (
            <ul className="space-y-1.5 text-[13px]" data-testid="accepted-list">
              {accepted.map((a) => <li key={a.key} className="rounded bg-[#efe3f5] px-3 py-2"><b className="font-semibold">{a.period ? `${ml(a.period)}: ` : ""}{a.title}</b><div className="text-mute">“{a.reason}” · {a.by}, {fmtDate(a.at)}</div></li>)}
            </ul>
          ) : <p className="text-sm text-mute">{t.noneDot}</p>}
        </section>
      )}

      <SourceDrawer line={trace} onClose={() => setTrace(null)} />
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-medium"><History className="h-4 w-4" />{t.history}</h2>
        <History_ rows={history} companyId={companyId} readOnly={readOnly} />
      </section>
    </div>
  );
}

function History_({ rows, companyId, readOnly }: { rows: HistoryRow[]; companyId: string; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { T, t, fmtDate, span } = useFmt();
  const restore = (r: HistoryRow) => async () => {
    setErr(null);
    const out = await restoreVersion(companyId, r.version!);
    if (!out.ok) return out.error ?? t.restoreFailed;
    setNote(out.notice ?? null);
    start(() => router.refresh());
  };
  if (!rows.length) return <p className="text-sm text-mute">{t.noImports}</p>;
  return (
    <div tabIndex={0} className="overflow-x-auto">
      {err && <p className="mb-2 rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      {note && <p className="mb-2 rounded bg-band px-3 py-2 text-sm" data-testid="restore-notice">{note}</p>}
      <table className="tbl text-[13px]" data-testid="history">
        <thead><tr><th className="!text-start">{t.when}</th><th className="!text-start">{t.what}</th><th className="!text-start">{t.monthsCol}</th><th className="!text-start">{t.by}</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cn("row", r.current && "bg-brand-bg/40")}>
              <td className="!text-start">{fmtDate(r.at)}</td>
              <td className="max-w-72 truncate !text-start">
                {r.action === "restore" ? <span>{t.restored(r.file)}</span> : <span><span className="capitalize">{r.kind === "odoo" ? t.odooSync : T.lang === "ar" ? t.kind[r.kind] ?? r.kind : r.kind}</span>{r.file ? ` · ${r.file}` : ""}</span>}
                {r.mode && r.action === "import" && <span className="ms-1.5 rounded bg-band px-1.5 text-[11px] text-mute">{r.mode === "merge" ? t.mode.merge : r.mode === "add" ? t.mode.add : t.mode.replace}</span>}
                {r.accepted > 0 && <span className="ms-1.5 rounded bg-[#efe3f5] px-1.5 text-[11px]">{t.acceptedN(r.accepted)}</span>}
                {!!r.fixes?.length && (
                  <details className="mt-0.5 whitespace-normal text-[12px] text-mute" data-testid="history-fixes">
                    <summary className="cursor-pointer">{t.corrections(r.fixes.length)}</summary>
                    <ul className="mt-1 list-disc ps-4">{r.fixes.slice(0, 30).map((f, i) => <li key={i}>{fixText(f, t)}</li>)}</ul>
                  </details>
                )}
              </td>
              <td className="!text-start text-mute">{r.action === "restore" ? "–" : [r.pl.length ? t.plSpan(span(r.pl)) : "", r.bs.length ? t.bsSpan(span(r.bs)) : ""].filter(Boolean).join(" · ") || "–"}</td>
              <td className="!text-start text-mute">{r.by ?? "–"}</td>
              <td>
                {r.current ? <span className="text-xs font-semibold text-brand-d">{t.current}</span>
                  : r.restorable && !readOnly ? r.version ? <ConfirmDialog title={t.restoreQ} confirmLabel={t.restore} onConfirm={restore(r)} testId="restore-dialog"
                      trigger={<button disabled={pending} className="inline-flex items-center gap-1 text-xs text-brand-d underline disabled:opacity-50" data-testid="restore"><RotateCcw className="h-3 w-3" />{t.restore}</button>}>
                      <p>{t.restoreText(r.file ?? r.kind, fmtDate(r.at))}</p>
                      <p className="text-mute">{t.restoreKeep}</p>
                    </ConfirmDialog> : null
                    : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "P&L, row 11, column E set to 5,000 (was 'five thousand')". */
function fixText(f: FixRecord, t: { leftOut: (where: string, was: string | undefined) => string; leftEmpty: (where: string, was: string) => string; setTo: (where: string, v: string, was: string) => string }) {
  const where = `${f.sheet.split(" › ").pop()}, ${cellRef(f.row, f.col)}`;
  if (f.action === "skip-row") return t.leftOut(where, f.was || undefined);
  const v = typeof f.value === "number" ? f.value.toLocaleString("en-US") : f.value;
  return f.action === "empty" ? t.leftEmpty(where, f.was ?? "") : t.setTo(where, String(v), f.was ?? "");
}

function Tile({ label, value, sub, tone = "ok", testid }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" | "warn"; testid?: string }) {
  return (
    <div className={cn("rounded-md border-t-[3px] bg-band px-3 py-2.5", tone === "bad" ? "border-red" : tone === "warn" ? "border-amber" : "border-green")} data-testid={testid}>
      <div className="label">{label}</div>
      <div className="num text-lg">{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}
