"use client";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { money, mshort } from "@/lib/engine";
import { checkKey, groupChecks, periodsLabel, type Check } from "@/lib/company/checks";
import type { ImportMode, MonthDiff, SliceState, TimelineCell } from "@/lib/company/import-plan";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";
import { monthNames } from "@/lib/i18n";

/** "2026-10-10" as a day in the chosen language ("10 Oct 2026" / "10 أكتوبر 2026"). */
export const dayIn = (t: { lang: "en" | "ar" }, d: string) => `${Number(d.slice(8))} ${monthNames(t.lang)[Number(d.slice(5, 7))]} ${d.slice(0, 4)}`;

export type PreviewCheck = Check & { accepted?: boolean };

const STATE: Record<SliceState, { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-green-d text-white" },
  overwrite: { label: "Replaced", cls: "bg-amber text-ink" },
  keep: { label: "Kept", cls: "bg-[#dcdcd6] text-ink" },
  remove: { label: "Removed", cls: "bg-red text-white" },
};

/** Month-by-month picture of what an import changes, per statement. */
export function Timeline({ cells, checks }: { cells: TimelineCell[]; checks: PreviewCheck[] }) {
  const T = useT(), w = T.d.wiz.tl, lbl = (s: SliceState) => (T.lang === "en" ? STATE[s].label : w.state[s] ?? STATE[s].label);
  const flag = (p: string, st: "PL" | "BS") => {
    const cs = checks.filter((c) => c.period === p && (c.statement ?? st) === st && c.severity !== "info");
    return cs.some((c) => c.severity === "block" && !c.accepted && !c.existing) ? "block" : cs.length ? "warn" : null;
  };
  return (
    <div data-testid="timeline">
      <div tabIndex={0} className="-mx-1 overflow-x-auto px-1 pb-1">
        <table className="border-separate border-spacing-[3px] text-[11px]">
          <thead><tr><th className="w-24" />{cells.map((c) => <th key={c.period} className="min-w-11 text-center font-normal text-mute">{T.lang === "en" ? mshort(c.period) : T.ms(c.period)}</th>)}</tr></thead>
          <tbody>
            {(["PL", "BS"] as const).map((st) => (
              <tr key={st}>
                <td className="pe-2 text-[12px] font-medium">{st === "PL" ? w.pl : w.bs}</td>
                {cells.map((c) => {
                  const s = c[st];
                  const f = flag(c.period, st);
                  return (
                    <td key={c.period} title={`${T.ml(c.period)} · ${s ? lbl(s) : w.noData}${f ? ` · ${f === "block" ? w.checkFailed : w.warning}` : ""}`}
                      className={cn("relative h-7 rounded-sm text-center", s ? STATE[s].cls : "border border-dashed border-line bg-white", s === "remove" && "line-through")}
                      data-state={s ?? "none"}>
                      {f && <span className={cn("absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-white", f === "block" ? "bg-red" : "bg-[#9a6b00]")} />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
        {(Object.keys(STATE) as SliceState[]).map((k) => <span key={k} className="flex items-center gap-1.5"><span className={cn("inline-block h-3 w-3 rounded-sm", STATE[k].cls)} />{lbl(k)}</span>)}
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-sm border border-dashed border-line" />{w.noData}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-red" />{w.failedLegend}</span>
      </div>
    </div>
  );
}

const METRIC: Record<MonthDiff["metric"], string> = { revenue: "Revenue", net_income: "Net profit", cash: "Cash", ta: "Total assets" };

export function OverwriteDiffs({ diffs, currency }: { diffs: MonthDiff[]; currency: string }) {
  const T = useT(), w = T.d.wiz.tl;
  const changed = diffs.filter((d) => Math.abs(d.after - d.before) > 0.5);
  if (!diffs.length) return null;
  return (
    <div className="rounded-md border border-line p-3" data-testid="overwrite-diffs">
      <div className="label mb-2">{w.replacing}</div>
      {!changed.length ? <p className="text-sm text-mute">{w.same}</p> : (
        <div className="max-h-56 overflow-auto">
          <table className="tbl text-[12.5px]">
            <thead><tr><th className="!text-start">{w.month}</th><th className="!text-start">{w.figure}</th><th>{w.before}</th><th>{w.after}</th><th>{w.change}</th></tr></thead>
            <tbody>{changed.map((d) => (
              <tr key={d.period + d.metric}><td className="!text-start">{T.ml(d.period)}</td><td className="!text-start">{T.lang === "en" ? METRIC[d.metric] : w.metric[d.metric] ?? METRIC[d.metric]}</td><td>{money(d.before, currency)}</td><td>{money(d.after, currency)}</td><td className={d.after - d.before < 0 ? "text-red" : "text-green-d"}>{money(d.after - d.before, currency)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function CheckList({ checks, empty }: { checks: PreviewCheck[]; empty?: string }) {
  const T = useT(), w = T.d.wiz.tl;
  const sorted = [...checks].sort((a, b) => rank(a) - rank(b) || (a.period ?? "").localeCompare(b.period ?? ""));
  if (!sorted.length) return <p className="flex items-center gap-2 text-sm text-green-d"><CheckCircle2 className="h-4 w-4" />{empty ?? w.allPassed}</p>;
  // One problem repeated month after month is listed once, with the months it affects.
  const shown = groupChecks(sorted.map((c) => ({ ...c, existing: c.existing || undefined, accepted: c.accepted || undefined })));
  return (
    <ul className="space-y-1.5 text-[13px]" data-testid="check-list">
      {shown.map(({ check: c, periods }) => {
        const blocking = c.severity === "block" && !c.accepted && !c.existing;
        const many = periods.length > 1;
        return (
          <li key={checkKey(c) + c.title} className={cn("flex gap-2 rounded px-3 py-2", blocking ? "bg-red-bg" : c.severity === "info" ? "bg-band" : "bg-amber/15")} data-severity={blocking ? "block" : c.severity}>
            {blocking ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red" /> : c.severity === "info" ? <Info className="mt-0.5 h-4 w-4 shrink-0 text-mute" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#7d5600]" />}
            <div>
              <b className="font-semibold">{periods.length ? `${periodsLabel(periods, T.ml)}: ` : ""}{c.title}</b>
              {c.accepted && <span className="ms-2 rounded bg-white px-1.5 text-[11px] text-mute">{w.acceptedEarlier}</span>}
              {c.existing && <span className="ms-2 rounded bg-white px-1.5 text-[11px] text-mute">{w.existing}</span>}
              <div className="text-mute">{many && c.id === "bs_balance" && c.diff !== undefined
                ? w.outBy(Math.round(Math.abs(c.diff)).toLocaleString("en-GB"))
                : c.detail}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
const rank = (c: PreviewCheck) => (c.severity === "block" && !c.accepted && !c.existing ? 0 : c.severity === "block" ? 1 : c.severity === "warn" ? 2 : 3);

export function ModeChoice({ mode, onChange, hasData }: { mode: ImportMode; onChange: (m: ImportMode) => void; hasData: boolean }) {
  const w = useT().d.wiz.tl;
  if (!hasData) return null;
  const opt = (m: ImportMode, title: string, sub: string) => (
    <label className={cn("flex flex-1 cursor-pointer gap-3 rounded-md border p-3", mode === m ? "border-brand-d bg-brand-bg/40" : "border-line")}>
      <input type="radio" name="import-mode" checked={mode === m} onChange={() => onChange(m)} className="mt-1" data-testid={`mode-${m}`} />
      <span><span className="block font-medium">{title}</span><span className="text-xs text-mute">{sub}</span></span>
    </label>
  );
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {opt("merge", w.merge, w.mergeSub)}
      {opt("replace", w.replace, w.replaceSub)}
    </div>
  );
}
