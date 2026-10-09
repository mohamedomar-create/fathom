"use client";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { MONTH_ABBR, mlabel, selectableEnds, windowFor, type PeriodType } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { usePeriod } from "@/lib/company/use-period";
import { cn } from "@/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SentenceSelect } from "@/components/ui/sentence-select";

const TYPE_LABEL: Record<PeriodType, string> = { month: "Month", quarter: "Quarter", year: "Year" };

/** "For the [Month ▾] of [Sep 2026 ▾]" — or "Up to the …" for cumulative views. */
export function PeriodPicker({ mode = "for", allowTypes = true }: { mode?: "for" | "upto"; allowTypes?: boolean }) {
  const c = useCompany();
  const { sel, set, periods } = usePeriod();
  const fy = c.settings.fyStartMonth;
  const label = sel.end ? windowFor(sel, fy).label : "–";
  return (
    <div className="sent text-[15px]" data-testid="period-picker">
      {mode === "for" ? "For the " : "Up to the "}
      {allowTypes ? (
        <SentenceSelect
          testId="period-type"
          value={sel.type}
          onChange={(type) => {
            const ends = selectableEnds(c.months, type, fy);
            const match = ends.find((e) => windowFor({ type, end: e.end }, fy).periods.includes(sel.end));
            set({ type, end: match?.end ?? ends[ends.length - 1]?.end });
          }}
          options={(["month", "quarter", "year"] as PeriodType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
        />
      ) : (
        <b>Month</b>
      )}{" "}
      of <PeriodPopover label={sel.type === "month" ? mlabel(sel.end) : label} type={allowTypes ? sel.type : "month"} periods={periods} />
    </div>
  );
}

function PeriodPopover({ label, type, periods }: { label: string; type: PeriodType; periods: string[] }) {
  const c = useCompany();
  const { sel, set } = usePeriod();
  const [open, setOpen] = useState(false);
  const fy = c.settings.fyStartMonth;
  const years = useMemo(() => [...new Set(periods.map((p) => Number(p.slice(0, 4))))].sort(), [periods]);
  const [year, setYear] = useState(Number(sel.end?.slice(0, 4)));
  const has = new Set(periods);
  const ends = useMemo(() => selectableEnds(c.months, type, fy), [c.months, type, fy]);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setYear(Number(sel.end.slice(0, 4))); }}>
      <PopoverTrigger className="sent-link" data-testid="period-end">
        {label}
        <ChevronDown className="ml-0.5 inline h-3.5 w-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-3">
        {type === "month" ? (
          <div className="flex gap-3">
            <div className="w-20 border-r border-line pr-2">
              <div className="label mb-1">Year</div>
              {years.map((y) => (
                <button key={y} onClick={() => setYear(y)} className={cn("block w-full rounded px-2 py-1 text-left text-sm hover:bg-band", y === year && "font-semibold text-green-d")}>{y}</button>
              ))}
            </div>
            <div className="flex-1">
              <div className="label mb-1 flex items-center justify-between">
                <span>Select a month</span>
                <span className="flex gap-1">
                  <button aria-label="Previous year" onClick={() => setYear((y) => Math.max(years[0], y - 1))}><ChevronLeft className="h-4 w-4" /></button>
                  <button aria-label="Next year" onClick={() => setYear((y) => Math.min(years[years.length - 1], y + 1))}><ChevronRight className="h-4 w-4" /></button>
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {MONTH_ABBR.slice(1).map((mm, i) => {
                  const p = `${year}-${String(i + 1).padStart(2, "0")}`;
                  const ok = has.has(p);
                  return (
                    <button key={mm} disabled={!ok} data-testid={`month-${p}`}
                      onClick={() => { set({ end: p }); setOpen(false); }}
                      className={cn("rounded py-1.5 text-sm", ok ? "hover:bg-band" : "cursor-not-allowed text-[#ccc]", p === sel.end && "bg-green-bg font-semibold text-green-d")}>
                      {mm}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="max-h-72 overflow-auto">
            {[...ends].reverse().map((e) => (
              <button key={e.end} onClick={() => { set({ end: e.end }); setOpen(false); }}
                className={cn("block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-band", e.end === sel.end && "bg-green-bg font-semibold text-green-d")}>
                {e.label}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
