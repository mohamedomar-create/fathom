"use client";
import { CheckCircle2, History, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { mlabel } from "@/lib/engine";
import { restoreVersion, type AcceptedItem } from "@/app/company/[id]/settings/actions";
import { cn } from "@/lib/cn";
import { CheckList, type PreviewCheck } from "./import-timeline";
import { SourceDrawer, type SourceLine } from "@/components/analysis/source-drawer";

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
}

type Status = "ok" | "warn" | "block" | "accepted" | "missing" | "none";
const STATUS: Record<Status, { label: string; cls: string }> = {
  ok: { label: "Checks pass", cls: "bg-green text-white" },
  warn: { label: "Warning", cls: "bg-amber text-ink" },
  accepted: { label: "Accepted issue", cls: "bg-[#c9a0dc] text-ink" },
  block: { label: "Check failed", cls: "bg-red text-white" },
  missing: { label: "Missing", cls: "bg-white border border-dashed border-red/60" },
  none: { label: "No data", cls: "bg-white border border-dashed border-line" },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const span = (ps: string[]) => (!ps.length ? "–" : ps.length === 1 ? mlabel(ps[0]) : `${mlabel(ps[0])} – ${mlabel(ps[ps.length - 1])}`);

export function DataHealth({ companyId, readOnly, justImported, coverage, checks, accepted, sources, history }: {
  companyId: string; readOnly: boolean; justImported: boolean;
  coverage: { range: string[]; pl: string[]; bs: string[] };
  checks: PreviewCheck[]; accepted: AcceptedItem[]; sources: Record<string, MonthSource[]>; history: HistoryRow[];
}) {
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
      {justImported && <div className="flex items-center gap-2 rounded-md bg-green-bg px-4 py-3 text-sm" data-testid="import-done"><CheckCircle2 className="h-4 w-4 text-green-d" />Import saved. Here is how your data looks now.</div>}

      <div className="grid gap-3 sm:grid-cols-4">
        <Tile label="Profit & Loss" value={span(coverage.pl)} sub={`${coverage.pl.length} months`} />
        <Tile label="Balance sheet" value={span(coverage.bs)} sub={`${coverage.bs.length} months`} />
        <Tile label="Failed checks" value={String(failing.length)} tone={failing.length ? "bad" : "ok"} sub={failing.length ? "fix before relying on the numbers" : "none"} testid="failed-count" />
        <Tile label="Accepted / warnings" value={`${acceptedNow.length} / ${warns.length}`} tone={acceptedNow.length || warns.length ? "warn" : "ok"} sub="see the months marked below" />
      </div>

      {!coverage.range.length ? (
        <p className="text-mute">No financial data yet. <Link className="text-brand-d underline" href={`/company/${companyId}/settings/source-data`}>Upload an Odoo export</Link>.</p>
      ) : (
        <section>
          <h2 className="mb-1 text-lg font-medium">Months</h2>
          <p className="mb-3 text-sm text-mute">Click a month to see where its figures came from and which checks apply.</p>
          <div className="-mx-1 overflow-x-auto px-1" data-testid="health-calendar">
            <table className="border-separate border-spacing-[3px] text-[11px]">
              <thead><tr><th /><th />{MONTHS.map((m) => <th key={m} className="min-w-10 text-center font-normal text-mute">{m}</th>)}</tr></thead>
              <tbody>
                {years.map((y) => (["PL", "BS"] as const).map((st, i) => (
                  <tr key={y + st}>
                    <td className="pr-2 text-[12px] font-semibold">{i === 0 ? y : ""}</td>
                    <td className="pr-2 text-[11px] text-mute">{st === "PL" ? "P&L" : "BS"}</td>
                    {MONTHS.map((_, mi) => {
                      const p = `${y}-${String(mi + 1).padStart(2, "0")}`;
                      const s = status(p, st);
                      return (
                        <td key={p} className="p-0">
                          <button type="button" onClick={() => setSel(p)} title={`${mlabel(p)} · ${STATUS[s].label}`} aria-label={`${mlabel(p)} ${st === "PL" ? "profit and loss" : "balance sheet"}: ${STATUS[s].label}`}
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
            {(Object.keys(STATUS) as Status[]).map((k) => <span key={k} className="flex items-center gap-1.5"><span className={cn("inline-block h-3 w-3 rounded-sm", STATUS[k].cls)} />{STATUS[k].label}</span>)}
          </div>
        </section>
      )}

      {sel && coverage.range.length > 0 && (
        <section className="grid gap-6 lg:grid-cols-[1fr_320px]" data-testid="month-detail">
          <div>
            <h2 className="mb-3 text-lg font-medium">{mlabel(sel)}: checks</h2>
            <CheckList checks={selChecks} empty={pl.has(sel) || bs.has(sel) ? "All checks pass for this month." : "No data for this month."} />
            {(pl.has(sel) || bs.has(sel)) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]" data-testid="trace-buttons">
                <span className="text-mute">See the accounts behind:</span>
                {TRACE.filter((t) => (t.st === "PL" ? pl : bs).has(sel)).map((t) => (
                  <button key={t.key} type="button" onClick={() => setTrace({ key: t.key, label: `${t.label}, ${mlabel(sel)}`, statement: t.st, periods: [sel] })} className="rounded-full border border-line px-2.5 py-0.5 hover:bg-band">{t.label}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <h2 className="mb-3 text-lg font-medium">Source</h2>
            {(["PL", "BS"] as const).map((st) => {
              const list = sources[`${st}|${sel}`] ?? [];
              return (
                <div key={st} className="mb-3 rounded-md bg-band p-3 text-[13px]">
                  <div className="label mb-1">{st === "PL" ? "Profit & Loss" : "Balance sheet"}</div>
                  {!list.length ? <div className="text-mute">No data</div> : list.map((s) => (
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
          <h2 className="mb-3 text-lg font-medium">Accepted issues</h2>
          {accepted.length ? (
            <ul className="space-y-1.5 text-[13px]" data-testid="accepted-list">
              {accepted.map((a) => <li key={a.key} className="rounded bg-[#efe3f5] px-3 py-2"><b className="font-semibold">{a.period ? `${mlabel(a.period)}: ` : ""}{a.title}</b><div className="text-mute">“{a.reason}” · {a.by}, {fmtDate(a.at)}</div></li>)}
            </ul>
          ) : <p className="text-sm text-mute">None.</p>}
        </section>
      )}

      <SourceDrawer line={trace} onClose={() => setTrace(null)} />
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-medium"><History className="h-4 w-4" />Import history</h2>
        <History_ rows={history} companyId={companyId} readOnly={readOnly} />
      </section>
    </div>
  );
}

function History_({ rows, companyId, readOnly }: { rows: HistoryRow[]; companyId: string; readOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const restore = (r: HistoryRow) => {
    if (!r.version || !confirm(`Restore the data as it was after "${r.file ?? r.kind}" (${fmtDate(r.at)})? The current data stays in the history and can be restored again.`)) return;
    setErr(null);
    start(async () => {
      const out = await restoreVersion(companyId, r.version!);
      if (!out.ok) setErr(out.error ?? "Restore failed.");
      else router.refresh();
    });
  };
  if (!rows.length) return <p className="text-sm text-mute">No imports yet.</p>;
  return (
    <div className="overflow-x-auto">
      {err && <p className="mb-2 rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      <table className="tbl text-[13px]" data-testid="history">
        <thead><tr><th className="!text-left">When</th><th className="!text-left">What</th><th className="!text-left">Months</th><th className="!text-left">By</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={cn("row", r.current && "bg-brand-bg/40")}>
              <td className="!text-left">{fmtDate(r.at)}</td>
              <td className="max-w-72 truncate !text-left">
                {r.action === "restore" ? <span>Restored earlier data{r.file ? ` (${r.file})` : ""}</span> : <span><span className="capitalize">{r.kind === "odoo" ? "Odoo sync" : r.kind}</span>{r.file ? ` · ${r.file}` : ""}</span>}
                {r.mode && r.action === "import" && <span className="ml-1.5 rounded bg-band px-1.5 text-[11px] text-mute">{r.mode === "merge" ? "merged" : "replaced all"}</span>}
                {r.accepted > 0 && <span className="ml-1.5 rounded bg-[#efe3f5] px-1.5 text-[11px]">{r.accepted} accepted</span>}
              </td>
              <td className="!text-left text-mute">{r.action === "restore" ? "–" : [r.pl.length ? `P&L ${span(r.pl)}` : "", r.bs.length ? `BS ${span(r.bs)}` : ""].filter(Boolean).join(" · ") || "–"}</td>
              <td className="!text-left text-mute">{r.by ?? "–"}</td>
              <td>
                {r.current ? <span className="text-xs font-semibold text-brand-d">Current</span>
                  : r.restorable && !readOnly ? <button disabled={pending} onClick={() => restore(r)} className="inline-flex items-center gap-1 text-xs text-brand-d underline disabled:opacity-50" data-testid="restore"><RotateCcw className="h-3 w-3" />Restore</button>
                    : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
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
