"use client";
import { useEffect, useMemo, useState } from "react";
import type { Cell } from "@/lib/ingest/parse";
import { colLetter, type CellError, type Marks, type RowRole } from "@/lib/ingest/trace";
import { mlabel } from "@/lib/engine";
import { cn } from "@/lib/cn";
import { useWindow } from "./virtual";

/** One sheet for the left box: its rows as uploaded, where each row went, the cells that cannot be read, and what each used column holds. */
export interface RawSheetData {
  name: string;
  rows: Cell[][];
  origin?: { r: number; c: number };
  trace: Marks;
  errors: CellError[];
  /** Column (as uploaded) → what iReport reads from it: a month ("2026-01") or a field name ("Customer"). */
  heads?: Record<number, string>;
  /** Columns that were left out (budget, a repeated month, or by you). */
  leftOut?: number[];
}

const ROW_H = 26;
export const ROLE: Record<RowRole, { label: string; row: string; dot: string }> = {
  account: { label: "Used", row: "bg-brand-bg/50", dot: "bg-brand-d" },
  entry: { label: "Used (line)", row: "bg-brand-bg/25", dot: "bg-brand" },
  opening: { label: "Opening balance", row: "bg-brand-bg/50", dot: "bg-brand-d" },
  heading: { label: "Heading", row: "font-medium text-ink/80", dot: "bg-ink/40" },
  header: { label: "Headings", row: "bg-band font-medium", dot: "bg-ink" },
  title: { label: "Title", row: "text-mute", dot: "bg-line" },
  total: { label: "Total (we add our own)", row: "text-mute italic", dot: "bg-[#b9b9b0]" },
  unused: { label: "Not used", row: "text-mute/80", dot: "bg-line" },
  skipped: { label: "Skipped", row: "text-mute line-through", dot: "bg-line" },
  error: { label: "Problem", row: "bg-red-bg/70", dot: "bg-red" },
};
const LEGEND: RowRole[] = ["account", "heading", "total", "unused", "error"];

const fmt = (v: Cell) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 2 })) : String(v));

/**
 * The left box: every sheet exactly as uploaded, spreadsheet row numbers and column letters, each row tinted by what
 * happened to it, unreadable cells outlined in red. Clicking a row shows the line it became on the right.
 */
export function RawSheets({ sheets, focus, onRow }: { sheets: RawSheetData[]; focus: { sheet: string; rows: number[] } | null; onRow: (sheet: string, row: number) => void }) {
  const [active, setActive] = useState(sheets[0]?.name ?? "");
  const [followed, setFollowed] = useState<object | null>(null);
  // A new focus (a line picked on the right) shows its sheet (adjusting state during render, as React recommends over an effect).
  if (focus && focus !== followed) { setFollowed(focus); if (sheets.some((s) => s.name === focus.sheet)) setActive(focus.sheet); }
  const sheet = sheets.find((s) => s.name === active) ?? sheets[0];
  if (!sheet) return <p className="p-4 text-sm text-mute">No sheets.</p>;
  return (
    <>
      {sheets.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-1.5" role="tablist">
          {sheets.map((s) => (
            <button key={s.name} role="tab" aria-selected={s.name === sheet.name} onClick={() => setActive(s.name)} data-testid={`raw-tab-${s.name}`}
              className={cn("shrink-0 rounded-t border border-b-0 px-2.5 py-1 text-xs", s.name === sheet.name ? "border-line bg-white font-medium" : "border-transparent text-mute")}>
              {s.name}{s.errors.length > 0 && <span className="ml-1.5 rounded-full bg-red px-1.5 text-[10px] text-white">{s.errors.length}</span>}
            </button>
          ))}
        </div>
      )}
      <Grid key={sheet.name} s={sheet} focus={focus?.sheet === sheet.name ? focus.rows : null} onRow={(r) => onRow(sheet.name, r)} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-3 py-2 text-[11px] text-mute" data-testid="raw-legend">
        {LEGEND.map((r) => <span key={r} className="flex items-center gap-1"><i className={cn("inline-block h-2 w-2 rounded-full", ROLE[r].dot)} />{ROLE[r].label}</span>)}
      </div>
    </>
  );
}

function Grid({ s, focus, onRow }: { s: RawSheetData; focus: number[] | null; onRow: (row: number) => void }) {
  // Trailing empty rows are not drawn; the widest row sets the columns.
  const count = useMemo(() => { let n = s.rows.length; while (n > 0 && !(s.rows[n - 1] ?? []).some((v) => fmt(v) !== "")) n--; return n; }, [s.rows]);
  const width = useMemo(() => { let w = 0; for (let i = 0; i < count; i++) w = Math.max(w, s.rows[i]?.length ?? 0); return Math.min(w, 40); }, [s.rows, count]);
  const colW = useMemo(() => Array.from({ length: width }, (_, c) => {
    let m = 4;
    for (let i = 0; i < Math.min(count, 400); i++) m = Math.max(m, fmt(s.rows[i]?.[c]).length);
    return Math.min(230, Math.max(56, m * 7 + 14));
  }), [s.rows, width, count]);
  const errAt = useMemo(() => new Map(s.errors.map((e) => [`${e.row}:${e.col}`, e])), [s.errors]);
  const out = useMemo(() => new Set(s.leftOut ?? []), [s.leftOut]);
  const { ref, start, end, scrollTo } = useWindow(count, ROW_H);
  const first = focus?.[0];
  useEffect(() => { if (first !== undefined) scrollTo(first, 44); }, [first, scrollTo]);
  const fset = useMemo(() => new Set(focus ?? []), [focus]);
  const o = s.origin ?? { r: 0, c: 0 };
  const total = 44 + colW.reduce((a, b) => a + b, 0);
  return (
    <div ref={ref} className="relative min-h-[320px] flex-1 overflow-auto lg:h-[64vh] lg:flex-none" data-testid="raw-grid" data-sheet={s.name}>
      <div style={{ width: total, height: count * ROW_H + 44 }} className="relative text-[12px]">
        <div className="sticky top-0 z-10 bg-white" style={{ width: total }}>
          <div className="flex border-b border-line bg-band text-[10.5px] text-mute">
            <div className="w-11 shrink-0" />
            {colW.map((w, c) => <div key={c} style={{ width: w }} className="shrink-0 border-l border-line px-1.5 py-0.5 text-center">{colLetter(c + o.c)}</div>)}
          </div>
          <div className="flex border-b border-line text-[10.5px]">
            <div className="w-11 shrink-0" />
            {colW.map((w, c) => {
              const h = s.heads?.[c];
              return <div key={c} style={{ width: w }} className={cn("shrink-0 truncate border-l border-line px-1.5 py-0.5 text-center", out.has(c) ? "bg-[repeating-linear-gradient(45deg,#f1f1ec,#f1f1ec_4px,#fff_4px,#fff_8px)] text-mute" : h ? "bg-brand-bg font-medium text-brand-d" : "")} title={out.has(c) ? "Skipped" : h ? `Read as ${h}` : undefined}>
                {out.has(c) ? "left out" : h ? (/^\d{4}-\d{2}$/.test(h) ? mlabel(h) : h) : ""}
              </div>;
            })}
          </div>
        </div>
        {Array.from({ length: Math.max(0, end - start) }, (_, k) => {
          const i = start + k;
          const row = s.rows[i] ?? [];
          const t = s.trace[i];
          const role = ROLE[t?.role ?? "unused"];
          const on = fset.has(i);
          return (
            <div key={i} onClick={() => onRow(i)} title={t ? `${role.label}${t.note ? `: ${t.note}` : ""}` : undefined} data-testid={`raw-row-${i}`} data-role={t?.role ?? "blank"} data-focus={on || undefined}
              style={{ top: 44 + i * ROW_H, height: ROW_H, width: total }}
              className={cn("absolute left-0 flex cursor-pointer items-center border-b border-line/60 hover:bg-amber/10", t && role.row, on && "!bg-amber/25 outline outline-1 outline-amber")}>
              <div className="flex w-11 shrink-0 items-center justify-end gap-1 pr-1.5 text-[10.5px] text-mute"><i className={cn("inline-block h-1.5 w-1.5 rounded-full", t ? role.dot : "bg-transparent")} />{i + 1 + o.r}</div>
              {colW.map((w, c) => {
                const e = errAt.get(`${i}:${c}`);
                const v = row[c];
                return <div key={c} style={{ width: w }} title={e?.message} data-testid={e ? `raw-error-${i}-${c}` : undefined}
                  className={cn("shrink-0 truncate px-1.5", typeof v === "number" && "text-right tabular-nums", e && "rounded-sm bg-white font-medium text-red ring-2 ring-red")}>{fmt(v)}</div>;
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
