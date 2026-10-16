"use client";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { MONTH_ABBR, selectableEnds, selectableEndsOf, windowFor, type PeriodType } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { coverageOf } from "@/lib/company/checks";
import { usePeriod } from "@/lib/company/use-period";
import { cn } from "@/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SentenceSelect } from "@/components/ui/sentence-select";
import { monthLabel, monthNames, periodLabel } from "@/lib/i18n";
import { useDict, useLang } from "@/lib/i18n/context";

/** "For the [Month ▾] of [Sep 2026 ▾]" — or "Up to the …" for cumulative views. */
export function PeriodPicker({ mode = "for", allowTypes = true, own }: { mode?: "for" | "upto"; allowTypes?: boolean; /** A module's own months (Inventory), instead of the accounts'. */ own?: string[] }) {
  const c = useCompany();
  const d = useDict();
  const lang = useLang();
  const { sel, set, periods } = usePeriod(own);
  const fy = c.settings.fyStartMonth;
  const label = sel.end ? periodLabel(windowFor(sel, fy).label, lang) : "–";
  return (
    <div className="sent text-[15px]" data-testid="period-picker">
      {mode === "for" ? d.period.for : d.period.upto}
      {allowTypes ? (
        <SentenceSelect
          testId="period-type"
          value={sel.type}
          onChange={(type) => {
            const ends = own ? selectableEndsOf(own, type, fy) : selectableEnds(c.months, type, fy);
            const match = ends.find((e) => windowFor({ type, end: e.end }, fy).periods.includes(sel.end));
            set({ type, end: match?.end ?? ends[ends.length - 1]?.end });
          }}
          options={(["month", "quarter", "year"] as PeriodType[]).map((t) => ({ value: t, label: d.period[t] }))}
        />
      ) : (
        <b>{d.period.month}</b>
      )}{" "}
      {d.period.of} <PeriodPopover label={sel.type === "month" ? monthLabel(sel.end, lang) : label} type={allowTypes ? sel.type : "month"} periods={periods} own={own} />
      {c.asOf && sel.end && windowFor(sel, fy).periods.includes(c.asOf.slice(0, 7)) && (
        <span className="ms-2 rounded bg-amber/20 px-1.5 py-0.5 text-xs text-[#9a6b00]" title={d.period.partTitle} data-testid="part-month">{d.period.part(Number(c.asOf.slice(8)), monthNames(lang)[Number(c.asOf.slice(5, 7))])}</span>
      )}
    </div>
  );
}

function PeriodPopover({ label, type, periods, own }: { label: string; type: PeriodType; periods: string[]; own?: string[] }) {
  const c = useCompany();
  const d = useDict();
  const lang = useLang();
  const { sel, set } = usePeriod(own);
  const [open, setOpen] = useState(false);
  const fy = c.settings.fyStartMonth;
  const years = useMemo(() => [...new Set(periods.map((p) => Number(p.slice(0, 4))))].sort(), [periods]);
  const [year, setYear] = useState(Number(sel.end?.slice(0, 4)));
  const has = new Set(periods);
  // Months inside the loaded range with no figures at all are gaps, not zero months.
  const cov = useMemo(() => coverageOf(c.accounts), [c.accounts]);
  const gap = (p: string) => !own && has.has(p) && c.accounts.length > 0 && !cov.pl.has(p) && !cov.bs.has(p);
  const ends = useMemo(() => (own ? selectableEndsOf(own, type, fy) : selectableEnds(c.months, type, fy)), [c.months, type, fy, own]);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setYear(Number(sel.end.slice(0, 4))); }}>
      <PopoverTrigger className="sent-link" data-testid="period-end">
        {label}
        <ChevronDown className="ms-0.5 inline h-3.5 w-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-3">
        {type === "month" ? (
          <div className="flex gap-3">
            <div className="w-20 border-e border-line pe-2">
              <div className="label mb-1">{d.period.year}</div>
              {years.map((y) => (
                <button key={y} onClick={() => setYear(y)} className={cn("block w-full rounded px-2 py-1 text-start text-sm hover:bg-band", y === year && "font-semibold text-brand-d")}>{y}</button>
              ))}
            </div>
            <div className="flex-1">
              <div className="label mb-1 flex items-center justify-between">
                <span>{d.period.selectMonth}</span>
                <span className="flex gap-1">
                  <button aria-label={d.period.prevYear} onClick={() => setYear((y) => Math.max(years[0], y - 1))}><ChevronLeft className="flip-rtl h-4 w-4" /></button>
                  <button aria-label={d.period.nextYear} onClick={() => setYear((y) => Math.min(years[years.length - 1], y + 1))}><ChevronRight className="flip-rtl h-4 w-4" /></button>
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {MONTH_ABBR.slice(1).map((mm, i) => {
                  const name = monthNames(lang)[i + 1];
                  const p = `${year}-${String(i + 1).padStart(2, "0")}`;
                  const missing = gap(p);
                  const ok = has.has(p) && !missing;
                  return (
                    <button key={mm} disabled={!ok} data-testid={`month-${p}`} title={missing ? d.period.noMonth : undefined}
                      onClick={() => { set({ end: p }); setOpen(false); }}
                      className={cn("rounded py-1.5 text-sm", ok ? "hover:bg-band" : "cursor-not-allowed text-[#ccc]", missing && "border border-dashed border-amber text-[#b38a2e]", p === sel.end && "bg-brand-bg font-semibold text-brand-d")}>
                      {name}
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
                className={cn("block w-full rounded px-2 py-1.5 text-start text-sm hover:bg-band", e.end === sel.end && "bg-brand-bg font-semibold text-brand-d")}>
                {periodLabel(e.label, lang)}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
