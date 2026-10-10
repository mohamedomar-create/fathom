"use client";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { mlabel, money, mshort } from "@/lib/engine";
import { checkKey, type Check } from "@/lib/company/checks";
import type { ImportMode, MonthDiff, SliceState, TimelineCell } from "@/lib/company/import-plan";
import { cn } from "@/lib/cn";

export type PreviewCheck = Check & { accepted?: boolean };

const STATE: Record<SliceState, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-green text-white" },
  overwrite: { label: "Replaced", cls: "bg-amber text-ink" },
  keep: { label: "Kept", cls: "bg-[#dcdcd6] text-ink" },
  remove: { label: "Removed", cls: "bg-red text-white" },
};

/** Month-by-month picture of what an import changes, per statement. */
export function Timeline({ cells, checks }: { cells: TimelineCell[]; checks: PreviewCheck[] }) {
  const flag = (p: string, st: "PL" | "BS") => {
    const cs = checks.filter((c) => c.period === p && (c.statement ?? st) === st && c.severity !== "info");
    return cs.some((c) => c.severity === "block" && !c.accepted && !c.existing) ? "block" : cs.length ? "warn" : null;
  };
  return (
    <div data-testid="timeline">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <table className="border-separate border-spacing-[3px] text-[11px]">
          <thead><tr><th className="w-24" />{cells.map((c) => <th key={c.period} className="min-w-11 text-center font-normal text-mute">{mshort(c.period)}</th>)}</tr></thead>
          <tbody>
            {(["PL", "BS"] as const).map((st) => (
              <tr key={st}>
                <td className="pr-2 text-[12px] font-medium">{st === "PL" ? "Profit & Loss" : "Balance sheet"}</td>
                {cells.map((c) => {
                  const s = c[st];
                  const f = flag(c.period, st);
                  return (
                    <td key={c.period} title={`${mlabel(c.period)} · ${s ? STATE[s].label : "No data"}${f ? ` · ${f === "block" ? "check failed" : "warning"}` : ""}`}
                      className={cn("relative h-7 rounded-sm text-center", s ? STATE[s].cls : "border border-dashed border-line bg-white", s === "remove" && "line-through")}
                      data-state={s ?? "none"}>
                      {f && <span className={cn("absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-white", f === "block" ? "bg-red" : "bg-[#9a6b00]")} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
        {(Object.keys(STATE) as SliceState[]).map((k) => <span key={k} className="flex items-center gap-1.5"><span className={cn("inline-block h-3 w-3 rounded-sm", STATE[k].cls)} />{STATE[k].label}</span>)}
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-dashed border-line" />No data</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-red" />Check failed</span>
      </div>
    </div>
  );
}

const METRIC: Record<MonthDiff["metric"], string> = { revenue: "Revenue", net_income: "Net profit", cash: "Cash", ta: "Total assets" };

export function OverwriteDiffs({ diffs, currency }: { diffs: MonthDiff[]; currency: string }) {
  const changed = diffs.filter((d) => Math.abs(d.after - d.before) > 0.5);
  if (!diffs.length) return null;
  return (
    <div className="rounded-md border border-line p-3" data-testid="overwrite-diffs">
      <div className="label mb-2">Months being replaced</div>
      {!changed.length ? <p className="text-sm text-mute">The replaced months have the same revenue, net profit, cash and total assets as before.</p> : (
        <div className="max-h-56 overflow-auto">
          <table className="tbl text-[12.5px]">
            <thead><tr><th className="!text-left">Month</th><th className="!text-left">Figure</th><th>Before</th><th>After</th><th>Change</th></tr></thead>
            <tbody>{changed.map((d) => (
              <tr key={d.period + d.metric}><td className="!text-left">{mlabel(d.period)}</td><td className="!text-left">{METRIC[d.metric]}</td><td>{money(d.before, currency)}</td><td>{money(d.after, currency)}</td><td className={d.after - d.before < 0 ? "text-red" : "text-green-d"}>{money(d.after - d.before, currency)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CheckList({ checks, empty = "All checks passed." }: { checks: PreviewCheck[]; empty?: string }) {
  const shown = [...checks].sort((a, b) => rank(a) - rank(b) || (a.period ?? "").localeCompare(b.period ?? ""));
  if (!shown.length) return <p className="flex items-center gap-2 text-sm text-green-d"><CheckCircle2 className="h-4 w-4" />{empty}</p>;
  return (
    <ul className="space-y-1.5 text-[13px]" data-testid="check-list">
      {shown.map((c) => {
        const blocking = c.severity === "block" && !c.accepted && !c.existing;
        return (
          <li key={checkKey(c) + c.title} className={cn("flex gap-2 rounded px-3 py-2", blocking ? "bg-red-bg" : c.severity === "info" ? "bg-band" : "bg-amber/15")} data-severity={blocking ? "block" : c.severity}>
            {blocking ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red" /> : c.severity === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-mute" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#9a6b00]" />}
            <div>
              <b className="font-semibold">{c.period ? `${mlabel(c.period)}: ` : ""}{c.title}</b>
              {c.accepted && <span className="ml-2 rounded bg-white px-1.5 text-[11px] text-mute">accepted earlier</span>}
              {c.existing && <span className="ml-2 rounded bg-white px-1.5 text-[11px] text-mute">already in your data</span>}
              <div className="text-mute">{c.detail}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
const rank = (c: PreviewCheck) => (c.severity === "block" && !c.accepted && !c.existing ? 0 : c.severity === "block" ? 1 : c.severity === "warn" ? 2 : 3);

export function ModeChoice({ mode, onChange, hasData }: { mode: ImportMode; onChange: (m: ImportMode) => void; hasData: boolean }) {
  if (!hasData) return null;
  const opt = (m: ImportMode, title: string, sub: string) => (
    <label className={cn("flex flex-1 cursor-pointer gap-3 rounded-md border p-3", mode === m ? "border-brand-d bg-brand-bg/40" : "border-line")}>
      <input type="radio" name="import-mode" checked={mode === m} onChange={() => onChange(m)} className="mt-1" data-testid={`mode-${m}`} />
      <span><span className="block font-medium">{title}</span><span className="text-xs text-mute">{sub}</span></span>
    </label>
  );
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {opt("merge", "Merge by month", "Only the months in this file are added or replaced. Every other month stays as it is.")}
      {opt("replace", "Replace everything", "Remove all current data and keep only this file.")}
    </div>
  );
}
