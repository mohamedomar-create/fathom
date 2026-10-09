"use client";
import { FileSearch } from "lucide-react";
import { mlabel } from "@/lib/engine";
import type { Overrides, SheetLayout, SheetOverride } from "@/lib/ingest/extract";
import { cn } from "@/lib/cn";

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
  const set = (sheet: string, patch: Partial<SheetOverride>) => onChange({ ...overrides, [sheet]: { ...overrides[sheet], ...patch } });
  const setCol = (sheet: string, col: number, period: string | null) => set(sheet, { periods: { ...overrides[sheet]?.periods, [col]: period } });
  const attention = layouts.some((l) => l.kind === "none" || l.scale !== 1 || l.columns.some((c) => !c.used || c.months > 1));
  return (
    <details open={attention} className="mb-5 rounded-md border border-line" data-testid="file-reading">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm">
        <FileSearch className="h-4 w-4 text-green-d" />
        <span className="font-medium">How the file was read</span>
        <span className="text-mute">· {layouts.map((l) => `${l.sheet}: ${l.kind === "skipped" ? "left out" : `${l.lines} lines`}`).join(" · ")}</span>
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
                <span className={cn("text-mute", l.kind === "none" && "text-red")}>{KIND[l.kind]}{l.headerRow !== null && l.kind !== "skipped" ? ` · headings on row ${l.headerRow + 1}` : ""}</span>
                {l.kind !== "skipped" && (
                  <>
                    <label className="ml-auto flex items-center gap-1.5">Units
                      <select value={l.scale} onChange={(e) => set(l.sheet, { scale: Number(e.target.value) })} className="rounded border border-line bg-white px-1 py-0.5" data-testid="units">
                        <option value={1}>as shown</option><option value={1000}>thousands</option><option value={1000000}>millions</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1.5">Numbers
                      <select value={l.decimal} onChange={(e) => set(l.sheet, { decimal: e.target.value as "." | "," })} className="rounded border border-line bg-white px-1 py-0.5">
                        <option value=".">1,234.56</option><option value=",">1.234,56</option>
                      </select>
                    </label>
                  </>
                )}
              </div>
              {l.scaleFrom && l.kind !== "skipped" && <div className="mt-1 text-xs text-mute">Units taken from “{l.scaleFrom}”.</div>}
              {l.columns.length > 0 && l.kind !== "skipped" && (
                <div className="mt-2 grid gap-1.5 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
                  {l.columns.map((c) => (
                    <div key={c.col} className={cn("rounded border bg-white px-2 py-1.5", !c.used ? "border-dashed border-line opacity-70" : c.months > 1 ? "border-amber" : "border-line")}>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" checked={c.used} onChange={(e) => setCol(l.sheet, c.col, e.target.checked ? c.period : null)} aria-label={`Use column ${c.header}`} />
                        <span className="min-w-0 flex-1 truncate" title={c.header}>{c.header || `Column ${c.col + 1}`}</span>
                        <input type="month" value={c.period ?? ""} onChange={(e) => e.target.value && setCol(l.sheet, c.col, e.target.value)} className="w-[132px] rounded border border-line px-1 text-[12px]" aria-label={`Month for ${c.header}`} />
                      </div>
                      {(!c.used || c.months > 1) && <div className={cn("mt-0.5 text-[11.5px]", c.used ? "text-[#9a6b00]" : "text-mute")}>{!c.used ? `Left out: ${c.reason ?? ""}` : `Covers ${c.months} months up to ${c.period ? mlabel(c.period) : "?"}`}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <p className="text-xs text-mute">Changing a column&apos;s month makes it a single month. Leaving a sheet out is the way to stop the same accounts being counted twice.</p>
      </div>
    </details>
  );
}
