"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Download } from "lucide-react";
import { mlabel, money, type ClassKey } from "@/lib/engine";
import { CLASS_LABEL, CLASS_OPTIONS } from "@/lib/ingest/classes";
import { cleanNum } from "@/lib/ingest/parse";
import { cellRef } from "@/lib/ingest/trace";
import { salesMonths, type SortedFinancials, type SortedRow, type UploadIssue } from "@/lib/ingest/sorted";
import type { SalesLine } from "@/lib/ingest/sales";
import { isPL } from "@/lib/company/build";
import { cn } from "@/lib/cn";
import { useWindow } from "./virtual";

export interface Focus { sheet: string; rows: number[] }
type Tab = "issues" | "pl" | "bs" | "sales" | "out";

export interface SortedViewProps {
  fin?: SortedFinancials | null;
  sales?: SalesLine[] | null;
  issues: UploadIssue[];
  currency: string;
  origin?: (sheet: string) => { r: number; c: number } | undefined;
  /** The line picked on the left (its key, or a sales line's sheet and row). */
  picked: { key?: string; sheet?: string; row?: number; note?: string } | null;
  /** A line or error picked: its rows in the file (stay: keep the reading in view on a phone, as "Next error" does). */
  onFocus: (f: Focus | null, o?: { stay?: boolean }) => void;
  onClass: (key: string, cls: ClassKey | "") => void;
  onCell: (sheet: string, row: number, col: number, value: number | string | null) => void;
  onSkipRow: (sheet: string, row: number) => void;
  onDownload?: () => void;
  downloading?: boolean;
}

/**
 * The right box: iReport's reading in its own format. On top, how many errors are left (the import stays locked until
 * there are none) with the fix for each in place; then the P&L and balance sheet as iReport will store them (or the sales
 * lines), the lines left out, and a download of this sorted data as a filled iReport template.
 */
export function SortedView(p: SortedViewProps) {
  const errors = p.issues.filter((i) => i.severity === "error"), checks = p.issues.filter((i) => i.severity === "check");
  const tabs: { k: Tab; label: string; n?: number }[] = [
    ...(errors.length || checks.length ? [{ k: "issues" as Tab, label: errors.length ? "Errors to fix" : "Checks", n: errors.length || checks.length }] : []),
    ...(p.fin && p.fin.plPeriods.length ? [{ k: "pl" as Tab, label: "P&L" }] : []),
    ...(p.fin && p.fin.bsPeriods.length ? [{ k: "bs" as Tab, label: "Balance sheet" }] : []),
    ...(p.sales?.length ? [{ k: "sales" as Tab, label: "Sales", n: p.sales.length }] : []),
    ...(p.fin && p.fin.leftOut.length ? [{ k: "out" as Tab, label: "Left out", n: p.fin.leftOut.length }] : []),
  ];
  const [tab, setTab] = useState<Tab>(errors.length ? "issues" : tabs.find((t) => t.k !== "issues")?.k ?? "issues");
  const shown = tabs.some((t) => t.k === tab) ? tab : tabs[0]?.k ?? "issues";
  // A line picked on the left opens the tab it is on.
  const [seen, setSeen] = useState<object | null>(null);
  if (p.picked && p.picked !== seen) {
    setSeen(p.picked);
    const k = p.picked.key;
    const inPl = k && p.fin?.pl.some((g) => g.rows.some((r) => r.key === k)), inBs = k && p.fin?.bs.some((g) => g.rows.some((r) => r.key === k));
    const t: Tab | null = inPl ? "pl" : inBs ? "bs" : k && p.fin?.leftOut.some((o) => o.key === k) ? "out" : p.picked.row !== undefined && p.sales?.some((l) => l.src?.sheet === p.picked!.sheet && l.src?.row === p.picked!.row) ? "sales" : null;
    if (t && t !== tab) setTab(t);
  }
  const [cursor, setCursor] = useState(0);
  const next = () => {
    if (!errors.length) return;
    const e = errors[cursor % errors.length];
    setCursor(cursor + 1); setTab("issues");
    if (e.row !== undefined) p.onFocus({ sheet: e.sheet, rows: [e.row] }, { stay: true });
  };
  return (
    <>
      <div className={cn("flex flex-wrap items-center gap-2 px-3 py-2 text-sm", errors.length ? "bg-red-bg text-red" : "bg-green-bg text-green-d")} data-testid="reading-status" data-errors={errors.length}>
        {errors.length ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        <b data-testid="error-count">{errors.length ? `${errors.length} error${errors.length > 1 ? "s" : ""} to fix` : "0 errors: ready to import"}</b>
        {!errors.length && checks.length > 0 && <span className="text-[12.5px] text-ink/70">· {checks.length} thing{checks.length > 1 ? "s" : ""} to check</span>}
        {errors.length > 0 && <button onClick={next} className="ml-auto inline-flex items-center gap-1 rounded border border-red/40 bg-white px-2 py-0.5 text-xs" data-testid="next-error">Next error<ChevronRight className="h-3 w-3" /></button>}
        {!errors.length && p.onDownload && (
          <button onClick={p.onDownload} disabled={p.downloading} className="ml-auto inline-flex items-center gap-1 rounded border border-brand-d bg-white px-2 py-0.5 text-xs text-brand-d disabled:opacity-50" data-testid="download-sorted">
            <Download className="h-3 w-3" />{p.downloading ? "Preparing…" : "Download as iReport template"}
          </button>
        )}
      </div>
      {p.picked?.note && <div className="border-b border-line bg-amber/10 px-3 py-1.5 text-[12.5px]" data-testid="picked-note">{p.picked.note}</div>}
      <div className="flex gap-1 overflow-x-auto border-b border-line px-2 pt-1.5" role="tablist">
        {tabs.map((t) => (
          <button key={t.k} role="tab" aria-selected={shown === t.k} onClick={() => setTab(t.k)} data-testid={`reading-tab-${t.k}`}
            className={cn("shrink-0 rounded-t border border-b-0 px-2.5 py-1 text-xs", shown === t.k ? "border-line bg-white font-medium" : "border-transparent text-mute")}>
            {t.label}{t.n !== undefined && <span className={cn("ml-1.5 rounded-full px-1.5 text-[10px]", t.k === "issues" && errors.length ? "bg-red text-white" : "bg-band")}>{t.n.toLocaleString("en-US")}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-[320px] flex-1 overflow-auto lg:h-[64vh] lg:flex-none" data-testid={`reading-${shown}`}>
        {shown === "issues" && <Issues {...p} errors={errors} checks={checks} />}
        {(shown === "pl" || shown === "bs") && p.fin && <Statement fin={p.fin} pl={shown === "pl"} currency={p.currency} picked={p.picked?.key} onFocus={p.onFocus} onClass={p.onClass} />}
        {shown === "sales" && p.sales && <SalesTable lines={p.sales} currency={p.currency} picked={p.picked} onFocus={p.onFocus} />}
        {shown === "out" && p.fin && <LeftOutList fin={p.fin} currency={p.currency} picked={p.picked?.key} onFocus={p.onFocus} onClass={p.onClass} />}
      </div>
    </>
  );
}

function ClassSelect({ value, onChange, label, compact }: { value: ClassKey | "" | null; onChange: (c: ClassKey | "") => void; label: string; compact?: boolean }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value as ClassKey | "")} aria-label={label} onClick={(e) => e.stopPropagation()}
      className={cn("max-w-48 rounded border bg-white px-1 py-0.5 text-left", compact ? "text-[11.5px]" : "text-[12.5px]", !value ? "border-red/60" : "border-line")}>
      <option value="">— Leave out —</option>
      <optgroup label="Profit & Loss">{CLASS_OPTIONS.filter(isPL).map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</optgroup>
      <optgroup label="Balance Sheet">{CLASS_OPTIONS.filter((c) => !isPL(c)).map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}</optgroup>
    </select>
  );
}

function Issues({ errors, checks, onFocus, onClass, onCell, onSkipRow, origin, fin }: SortedViewProps & { errors: UploadIssue[]; checks: UploadIssue[] }) {
  const clsOf = useMemo(() => {
    const m = new Map<string, ClassKey | null>();
    for (const g of [...(fin?.pl ?? []), ...(fin?.bs ?? [])]) for (const r of g.rows) m.set(r.key, r.cls);
    return m;
  }, [fin]);
  return (
    <ul className="divide-y divide-line text-[13px]" data-testid="issue-list">
      {errors.map((i) => <IssueRow key={i.id} i={i} origin={origin?.(i.sheet)} onFocus={onFocus} onClass={onClass} onCell={onCell} onSkipRow={onSkipRow} cls={i.key ? clsOf.get(i.key) ?? null : null} />)}
      {checks.length > 0 && <li className="bg-band px-3 py-1.5 text-xs font-medium text-mute">To check (these do not stop the import)</li>}
      {checks.map((i) => <IssueRow key={i.id} i={i} origin={origin?.(i.sheet)} onFocus={onFocus} onClass={onClass} onCell={onCell} onSkipRow={onSkipRow} cls={i.key ? clsOf.get(i.key) ?? null : null} />)}
      {!errors.length && !checks.length && <li className="px-3 py-6 text-center text-mute">Nothing to fix.</li>}
    </ul>
  );
}

function IssueRow({ i, origin, onFocus, onClass, onCell, onSkipRow, cls }: { i: UploadIssue; origin?: { r: number; c: number }; cls: ClassKey | null } & Pick<SortedViewProps, "onFocus" | "onClass" | "onCell" | "onSkipRow">) {
  const [v, setV] = useState(i.text ?? "");
  const [bad, setBad] = useState<string | null>(null);
  const isDate = /not a date|no invoice date|no month/.test(i.message);
  const apply = () => {
    const t = v.trim();
    if (isDate) { if (!t) { setBad("Type the date, e.g. 15/01/2026."); return; } onCell(i.sheet, i.row!, i.col!, t); return; }
    if (!t) { onCell(i.sheet, i.row!, i.col!, null); return; }
    const n = cleanNum(t);
    if (n === null || /[a-z]/i.test(t.replace(/^(egp|usd|eur)\s*/i, ""))) { setBad(`"${t}" is still not a number. Type digits, e.g. 5000.`); return; }
    onCell(i.sheet, i.row!, i.col!, n);
  };
  return (
    <li className={cn("px-3 py-2.5", i.severity === "error" ? "" : "text-ink/80")} data-testid={`issue-${i.fix}`} data-severity={i.severity}>
      <div className="flex items-start gap-2">
        {i.severity === "error" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#9a6b00]" />}
        <div className="min-w-0 flex-1">
          <div>{i.sheet && <span className="mr-1 font-medium">{i.sheet.split(" › ").pop()}{i.row !== undefined && !i.message.startsWith("row") ? `, ${cellRef(i.row, i.col, origin)}` : ""}:</span>}{i.message}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {i.row !== undefined && <button onClick={() => onFocus({ sheet: i.sheet, rows: [i.row!] })} className="text-xs text-brand-d underline" data-testid="show-in-file">Show in my file</button>}
            {i.fix === "cell" && i.classCell && (
              <ClassSelect value={null} label="Class for this row" compact onChange={(c) => c && onCell(i.sheet, i.row!, i.col!, CLASS_LABEL[c])} />
            )}
            {i.fix === "cell" && !i.classCell && (
              <form onSubmit={(e) => { e.preventDefault(); apply(); }} className="flex items-center gap-1.5">
                <input value={v} onChange={(e) => { setV(e.target.value); setBad(null); }} aria-label="Correct value" data-testid="fix-input"
                  placeholder={isDate ? "15/01/2026" : "5000"} className="w-32 rounded border border-line px-1.5 py-0.5 text-[12.5px]" />
                <button type="submit" className="rounded bg-brand-d px-2 py-0.5 text-xs text-white" data-testid="fix-apply">Use this</button>
              </form>
            )}
            {i.fix === "cell" && <button onClick={() => onSkipRow(i.sheet, i.row!)} className="text-xs text-mute underline" data-testid="fix-skip">Leave this row out</button>}
            {i.fix === "class" && i.key && <ClassSelect value={cls} label={`Class for ${i.message.slice(0, 40)}`} compact onChange={(c) => onClass(i.key!, c)} />}
            {i.fix === "settings" && i.severity === "error" && <span className="text-xs text-mute">Fix it under &quot;How the file was read&quot; (leave a sheet or column out), or upload a corrected file.</span>}
          </div>
          {bad && <div className="mt-1 text-xs text-red">{bad}</div>}
        </div>
      </div>
    </li>
  );
}

function Statement({ fin, pl, currency, picked, onFocus, onClass }: { fin: SortedFinancials; pl: boolean; currency: string; picked?: string; onFocus: (f: Focus | null) => void; onClass: (key: string, cls: ClassKey | "") => void }) {
  const ps = pl ? fin.plPeriods : fin.bsPeriods;
  const groups = pl ? fin.pl : fin.bs, totals = pl ? fin.plTotals : fin.bsTotals;
  const order = CLASS_OPTIONS.filter((k) => isPL(k) === pl);
  const amt = (v: number | undefined) => (v ? money(v, currency) : "–");
  const pickedRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => { pickedRef.current?.scrollIntoView({ block: "center" }); }, [picked]);
  const opening = !pl && fin.bsPeriods.length && fin.plPeriods.length && fin.bsPeriods[0] < fin.plPeriods[0] ? fin.bsPeriods[0] : null;
  return (
    <table className="w-max min-w-full border-collapse text-[12.5px]" data-testid={`sorted-${pl ? "pl" : "bs"}`}>
      <thead className="sticky top-0 z-10 bg-white">
        <tr className="border-b border-line text-[11.5px] text-mute">
          <th className="sticky left-0 z-10 bg-white px-2 py-1.5 text-left font-medium">Account and class</th>
          {ps.map((p) => <th key={p} className="px-2 py-1.5 text-right font-medium">{p === opening ? `Opening (end ${mlabel(p)})` : mlabel(p)}</th>)}
        </tr>
      </thead>
      <tbody>
        {order.map((cls) => {
          const g = groups.find((x) => x.cls === cls);
          return [
            g && (
              <tr key={`g-${cls}`} className="bg-band/70"><td className="sticky left-0 bg-band px-2 py-1 font-medium" colSpan={1}>{g.label}</td>{ps.map((p) => <td key={p} className="px-2 py-1 text-right font-medium tabular-nums">{amt(g.total[p])}</td>)}</tr>
            ),
            ...(g?.rows ?? []).map((r) => <AccountRow key={r.key} r={r} ps={ps} amt={amt} on={picked === r.key} rowRef={picked === r.key ? pickedRef : undefined} onFocus={onFocus} onClass={onClass} />),
            ...totals.filter((t) => t.after === cls).map((t) => (
              <tr key={`t-${t.label}`} className={cn("border-y border-line", t.strong && "font-semibold")} data-testid={`total-${t.label.split(" ")[0].toLowerCase()}`}>
                <td className="sticky left-0 bg-white px-2 py-1">{t.label}</td>
                {ps.map((p) => <td key={p} className={cn("px-2 py-1 text-right tabular-nums", t.zero && Math.abs(t.values[p] ?? 0) >= 1 && "bg-red-bg text-red")}>{t.zero ? (Math.abs(t.values[p] ?? 0) < 1 ? "0" : money(t.values[p], currency)) : amt(t.values[p])}</td>)}
              </tr>
            )),
          ];
        })}
      </tbody>
    </table>
  );
}

function AccountRow({ r, ps, amt, on, rowRef, onFocus, onClass }: { r: SortedRow; ps: string[]; amt: (v?: number) => string; on: boolean; rowRef?: React.Ref<HTMLTableRowElement>; onFocus: (f: Focus | null) => void; onClass: (key: string, cls: ClassKey | "") => void }) {
  return (
    <tr ref={rowRef} onClick={() => onFocus(r.src.rows.length ? { sheet: r.src.sheet, rows: r.src.rows.slice(0, 2000) } : null)} data-testid={`sorted-row`} data-key={r.key} data-status={r.status}
      className={cn("cursor-pointer border-b border-line/60 hover:bg-amber/10", r.status === "error" && "bg-red-bg/60", on && "!bg-amber/25")}>
      <td className="sticky left-0 bg-inherit px-2 py-1">
        <div className="flex items-center gap-2 bg-inherit">
          <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", r.status === "error" ? "bg-red" : r.status === "check" ? "bg-amber" : "bg-green")} title={r.status === "check" ? `Check the class: ${r.why}` : r.why} />
          <span className="max-w-56 truncate" title={r.name}>{r.code && <span className="mr-1 text-[11px] text-mute">{r.code}</span>}{r.name}</span>
          {!r.system && <ClassSelect value={r.cls} label={`Class for ${r.name}`} compact onChange={(c) => onClass(r.key, c)} />}
        </div>
      </td>
      {ps.map((p) => <td key={p} className="px-2 py-1 text-right tabular-nums">{amt(r.values[p])}</td>)}
    </tr>
  );
}

function LeftOutList({ fin, currency, picked, onFocus, onClass }: { fin: SortedFinancials; currency: string; picked?: string; onFocus: (f: Focus | null) => void; onClass: (key: string, cls: ClassKey | "") => void }) {
  return (
    <ul className="divide-y divide-line text-[12.5px]" data-testid="left-out">
      <li className="bg-band px-3 py-1.5 text-xs text-mute">Read from the file but not imported. Totals are left out because iReport works them out itself; give a line a class to include it.</li>
      {fin.leftOut.map((o) => {
        const last = Object.keys(o.values).sort().pop();
        return (
          <li key={o.key} onClick={() => onFocus(o.rows.length ? { sheet: o.sheet, rows: o.rows.slice(0, 2000) } : null)} className={cn("flex cursor-pointer flex-wrap items-center gap-2 px-3 py-1.5 hover:bg-amber/10", picked === o.key && "bg-amber/25")}>
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            <span className="text-[11.5px] text-mute">{o.why}</span>
            {last && <span className="tabular-nums text-mute">{money(o.values[last], currency)}</span>}
            {!/total|parent|check/.test(o.why) && <ClassSelect value="" label={`Class for ${o.label}`} compact onChange={(c) => onClass(o.key, c)} />}
          </li>
        );
      })}
    </ul>
  );
}

const SROW = 28;
function SalesTable({ lines, currency, picked, onFocus }: { lines: SalesLine[]; currency: string; picked: SortedViewProps["picked"]; onFocus: (f: Focus | null) => void }) {
  const { ref, start, end, scrollTo } = useWindow(lines.length, SROW);
  const idx = picked?.row !== undefined ? lines.findIndex((l) => l.src?.sheet === picked.sheet && l.src?.row === picked.row) : -1;
  useEffect(() => { if (idx >= 0) scrollTo(idx, 30); }, [idx, scrollTo]);
  const months = useMemo(() => salesMonths(lines), [lines]);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const cols = "grid grid-cols-[86px_100px_minmax(120px,1.2fr)_minmax(140px,1.5fr)_minmax(90px,1fr)_minmax(80px,0.8fr)_56px_96px_88px]";
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-line bg-band/60 px-3 py-1.5 text-[11.5px]" data-testid="sales-months">
        {months.map((m) => <span key={m.period}><b>{mlabel(m.period)}</b> {money(m.amount, currency, true)}</span>)}
        <span className="ml-auto font-medium" data-testid="sorted-sales-total">Total {money(total, currency)}</span>
      </div>
      <div ref={ref} className="relative flex-1 overflow-auto" data-testid="sorted-sales">
        <div style={{ height: lines.length * SROW + 30, minWidth: 900 }} className="relative text-[12px]">
          <div className={cn(cols, "sticky top-0 z-10 h-[30px] items-center border-b border-line bg-white text-[11px] font-medium text-mute")}>
            {["Date", "Invoice", "Customer", "Product", "Category", "Salesperson", "Qty", "Amount", "Cost"].map((h, i) => <div key={h} className={cn("truncate px-1.5", i >= 6 && "text-right")}>{h}</div>)}
          </div>
          {lines.slice(start, end).map((l, k) => {
            const i = start + k;
            return (
              <div key={i} onClick={() => l.src && onFocus({ sheet: l.src.sheet, rows: [l.src.row] })} style={{ top: 30 + i * SROW, height: SROW }} data-testid="sales-row"
                className={cn(cols, "absolute left-0 right-0 cursor-pointer items-center border-b border-line/60 hover:bg-amber/10", i === idx && "bg-amber/25")}>
                <div className="truncate px-1.5">{l.day ?? mlabel(l.period)}</div>
                <div className="truncate px-1.5">{l.doc}</div>
                <div className="truncate px-1.5" title={l.customer}>{l.customer}</div>
                <div className="truncate px-1.5" title={l.product}>{l.product}</div>
                <div className="truncate px-1.5 text-mute">{l.category}</div>
                <div className="truncate px-1.5 text-mute">{l.salesperson}</div>
                <div className="px-1.5 text-right tabular-nums">{l.qty ?? "–"}</div>
                <div className="px-1.5 text-right tabular-nums">{money(l.amount, currency)}</div>
                <div className="px-1.5 text-right tabular-nums text-mute">{l.cost === null ? "–" : money(l.cost, currency)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
