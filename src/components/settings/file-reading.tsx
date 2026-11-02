"use client";
import { FileSearch, ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n/use-t";
import type { Overrides, SheetLayout, SheetOverride } from "@/lib/ingest/extract";
import { cn } from "@/lib/cn";
import { fmtDay } from "@/lib/ingest/odoo";
import { dayIn } from "./import-timeline";

const KIND: Record<SheetLayout["kind"], string> = {
  columns: "Report with month columns",
  "trial-balance": "Trial balance (debit / credit)",
  list: "List of entries (account, date, amount)",
  ledger: "General ledger",
  none: "Not recognised: nothing read",
  skipped: "Left out",
};

/** "How the file was read": every interpretation the importer made, each one correctable. */
export function FileReading({ layouts, overrides, onChange }: { layouts: SheetLayout[]; overrides: Overrides; onChange: (o: Overrides) => void }) {
  const T = useT(), w = T.d.wiz.read;
  const set = (sheet: string, patch: Partial<SheetOverride>) => onChange({ ...overrides, [sheet]: { ...overrides[sheet], ...patch } });
  const setCol = (sheet: string, col: number, period: string | null) => set(sheet, { periods: { ...overrides[sheet]?.periods, [col]: period } });
  const attention = layouts.some((l) => l.kind === "none" || l.scale !== 1 || (l.role !== "check" && l.columns.some((c) => !c.used || c.months > 1)) || (l.dates && !l.dates.sample));
  const figures = (l: SheetLayout) => (l.kind === "skipped" ? (l.source ? w.noFigures : w.leftOut) : l.role === "check" ? w.checkOnly : w.lines(l.lines));
  return (
    <details open={attention} className="mb-5 rounded-md border border-line" data-testid="file-reading">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm">
        <FileSearch className="h-4 w-4 text-brand-d" />
        <span className="font-medium">{w.title}</span>
        <span className="text-mute">· {layouts.filter((l) => !(l.kind === "skipped" && l.source)).map((l) => `${l.sheet}: ${figures(l)}`).join(" · ")}</span>
      </summary>
      <div className="space-y-4 border-t border-line px-4 py-3">
        {layouts.map((l) => {
          const ov = overrides[l.sheet] ?? {};
          return (
            <div key={l.sheet} className={cn("rounded bg-band p-3 text-[13px]", l.kind === "skipped" && "opacity-70")} data-testid={`sheet-${l.sheet}`}>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={!ov.skip} onChange={(e) => set(l.sheet, { skip: !e.target.checked })} data-testid="use-sheet" />
                  {l.sheet}
                </label>
                <span className={cn("text-mute", l.kind === "none" && "text-red")}>{l.source ?? (T.lang === "en" ? KIND[l.kind] : w.kind[l.kind] ?? KIND[l.kind])}{l.headerRow !== null && l.kind !== "skipped" ? w.headingsOn(l.headerRow + 1) : ""}</span>
                {l.role === "check" && <span className="flex items-center gap-1 rounded bg-green-bg px-1.5 py-0.5 text-xs text-green-d" data-testid="check-only"><ShieldCheck className="h-3.5 w-3.5" />{w.checkChip}</span>}
                {l.kind !== "skipped" && (
                  <>
                    <label className="ms-auto flex items-center gap-1.5">{w.units}
                      <select value={l.scale} onChange={(e) => set(l.sheet, { scale: Number(e.target.value) })} className="rounded border border-line bg-white px-1 py-0.5" data-testid="units">
                        <option value={1}>{w.asShown}</option><option value={1000}>{w.thousands}</option><option value={1000000}>{w.millions}</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5">{w.numbers}
                      <select value={l.decimal} onChange={(e) => set(l.sheet, { decimal: e.target.value as "." | "," })} className="rounded border border-line bg-white px-1 py-0.5">
                        <option value=".">1,234.56</option><option value=",">1.234,56</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
              {l.scaleFrom && l.kind !== "skipped" && <div className="mt-1 text-xs text-mute">{w.unitsFrom(l.scaleFrom)}</div>}
              {l.dates && l.kind !== "skipped" && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs" data-testid="date-order">
                  <span className={cn(!l.dates.sample && !ov.dateOrder ? "text-[#7d5600]" : "text-mute")}>
                    {w.datesRead(l.dates.order === "mdy")}
                    {ov.dateOrder ? w.asChosen : l.dates.sample ? w.proved(l.dates.sample) : w.either}
                  </span>
                  <select value={l.dates.order} onChange={(e) => set(l.sheet, { dateOrder: e.target.value as "dmy" | "mdy" })} className="rounded border border-line bg-white px-1 py-0.5" aria-label={w.dateOrder}>
                    <option value="dmy">{w.dayFirst}</option><option value="mdy">{w.monthFirst}</option>
                  </select>
                </div>
              )}
              {l.asOf && l.kind !== "skipped" && <div className="mt-1 text-xs text-[#7d5600]">{w.stopOn(T.lang === "en" ? fmtDay(l.asOf) : dayIn(T, l.asOf))}</div>}
              {l.columns.length > 0 && l.kind !== "skipped" && l.role !== "check" && (
                <div className="mt-2 grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
                  {l.columns.map((c) => (
                    <div key={c.col} className={cn("rounded border bg-white px-2 py-1.5", !c.used ? "border-dashed border-line opacity-70" : c.months > 1 ? "border-amber" : "border-line")}>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={c.used} onChange={(e) => setCol(l.sheet, c.col, e.target.checked ? c.period : null)} aria-label={w.useCol(c.header)} />
                        <span className="min-w-0 flex-1 truncate" title={c.header}>{c.header || w.colN(c.col + 1)}</span>
                        <input type="month" value={c.period ?? ""} onChange={(e) => e.target.value && setCol(l.sheet, c.col, e.target.value)} className="w-[132px] rounded border border-line px-1 text-[12px]" aria-label={w.monthFor(c.header)} />
                      </div>
                      {(!c.used || c.months > 1) && <div className={cn("mt-0.5 text-[11.5px]", c.used ? "text-[#7d5600]" : "text-mute")}>{!c.used ? w.leftOutWhy(c.reason ?? "") : w.covers(c.months, c.period ? T.ml(c.period) : "?")}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <p className="text-xs text-mute">{w.note}</p>
      </div>
    </details>
  );
}

/** "Read as: …" for every sheet, on the Check step itself, with the person's choice when the guess was wrong. */
export function ReadAs({ layouts, overrides, onChange }: { layouts: SheetLayout[]; overrides: Overrides; onChange: (o: Overrides) => void }) {
  const T = useT(), w = T.d.wiz.read;
  const shown = layouts.filter((l) => l.kind !== "skipped");
  if (!shown.length) return null;
  const set = (sheet: string, readAs: SheetOverride["readAs"]) => onChange({ ...overrides, [sheet]: { ...overrides[sheet], readAs } });
  return (
    <div className="mb-4 rounded-md border border-line px-4 py-3 text-sm" data-testid="read-as">
      {shown.map((l) => (
        <div key={l.sheet} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-0.5" data-testid={`read-as-${l.sheet}`}>
          <span className="font-medium">{l.sheet}</span>
          <span><span className="text-mute">{w.readAsTitle}: </span><span data-testid="read-as-source" className={cn(l.kind === "none" && "text-red")}>{l.source ?? (T.lang === "en" ? KIND[l.kind] : w.kind[l.kind] ?? KIND[l.kind])}</span></span>
          <label className="ms-auto flex items-center gap-1.5 text-xs">{w.readAsPick}
            <select value={overrides[l.sheet]?.readAs ?? ""} onChange={(e) => set(l.sheet, (e.target.value || undefined) as SheetOverride["readAs"])} className="rounded border border-line bg-white px-1 py-0.5" data-testid="read-as-pick">
              {(["", "journal-items", "ledger", "trial-balance", "columns"] as const).map((k) => <option key={k} value={k}>{w.readAsOpt[k || "auto"]}</option>)}
            </select>
          </label>
        </div>
      ))}
      <details className="mt-2 text-xs" data-testid="layouts-help">
        <summary className="cursor-pointer text-brand-d underline">{w.layoutsLink}</summary>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-mute">{w.layouts.map((x) => <li key={x}>{x}</li>)}</ul>
        <a href={`/api/templates/journal-items?lang=${T.lang}`} download className="mt-2 inline-block text-brand-d underline" data-testid="template-journal-items">{w.journalSample}</a>
      </details>
    </div>
  );
}
