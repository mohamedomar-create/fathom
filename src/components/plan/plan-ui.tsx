"use client";
import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { money } from "@/lib/engine/format";
import { useT } from "@/lib/i18n/use-t";
import type { BusinessPlan, PlanCheck } from "@/lib/engine/plan";

/** The plan screens' words: English text as the key, the dictionary's words for the page language, {vars} filled in. */
export function usePlanT() {
  const T = useT();
  const s = (T.d as unknown as { bp: { s: Record<string, string> } }).bp.s;
  const t = (en: string, vars?: Record<string, string | number>) => {
    let out = s[en] ?? en;
    for (const [k, v] of Object.entries(vars ?? {})) out = out.split(`{${k}}`).join(String(v));
    return out;
  };
  return { t, T, lang: (T.lang === "ar" ? "ar" : "en") as "en" | "ar" };
}

/** Amounts: short on tiles and charts ("EGP 6.5M"), whole in tables ("EGP 6,450,000"). */
export const cm = (v: number, cur: string) => money(v, cur, true);
export const wm = (v: number, cur: string) => money(v, cur);
/** A table cell: negatives in brackets, as accountants write them. */
export const cell = (v: number) => {
  const s = Math.round(Math.abs(v)).toLocaleString("en-US");
  return v < -0.5 ? `(${s})` : s;
};

/** "Mar 2027" for a plan month (1-based), "at the start" for month 0. */
export function usePlanMonth() {
  const { t, T } = usePlanT();
  return (p: Pick<BusinessPlan, "startYear">, n: number) => {
    if (n <= 0) return t("at the start");
    const y = p.startYear + Math.floor((n - 1) / 12), m = ((n - 1) % 12) + 1;
    return T.ml(`${y}-${String(m).padStart(2, "0")}`);
  };
}

/** A finding of the plan check, in words: amounts in the company's currency, months named. */
export function useCheckText(cur: string) {
  const { t, T } = usePlanT();
  return (c: PlanCheck) => {
    const vars: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(c.vars ?? {})) {
      vars[k] = k === "amount" && typeof v === "number" ? cm(v, cur) : (k === "month" || k === "low") && typeof v === "string" && /^\d{4}-\d\d$/.test(v) ? T.ml(v) : v;
    }
    return t(c.text, vars);
  };
}

const AR_DIGITS = /[٠-٩]/g;
/** Reads typed text as a number: Arabic digits and the Arabic decimal mark too; a partial entry ("", "-", "1.") isn't one yet. */
export function readNum(s: string): number | null {
  const x = s.replace(AR_DIGITS, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, ".").replace(/[,٬\s]/g, "");
  if (!/^-?\d*\.?\d*$/.test(x) || x === "" || x === "-" || x === "." || x === "-.") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/** A number box: shows 120,000; on focus the raw number, selected; blank on leaving becomes 0. */
export function NumIn({ value, onChange, label, suffix, disabled, className, testId, min }: {
  value: number; onChange: (v: number) => void; label: string; suffix?: string; disabled?: boolean; className?: string; testId?: string; min?: number;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "");
  return (
    <span className={cn("relative inline-flex w-full items-center", className)}>
      <input dir="ltr" inputMode="decimal" aria-label={label} disabled={disabled} data-testid={testId} value={shown}
        className="num w-full rounded border border-line bg-white px-2 py-1 text-end text-[13px] focus:border-brand focus:outline-none disabled:bg-band disabled:text-mute"
        onFocus={(e) => { setText(String(value)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => { setText(e.target.value); const n = readNum(e.target.value); if (n !== null) onChange(min !== undefined ? Math.max(min, n) : n); }}
        onBlur={() => { if (text !== null && readNum(text) === null) onChange(0); setText(null); }} />
      {suffix && <span className="pointer-events-none ms-1 shrink-0 text-[11px] text-mute">{suffix}</span>}
    </span>
  );
}

export interface Col<R> {
  key: string; label: string; kind: "text" | "num" | "calc"; width?: string; suffix?: string; min?: number;
  hint?: (r: R) => React.ReactNode; calc?: (r: R) => React.ReactNode; total?: React.ReactNode;
}

/** A spreadsheet-like table of rows: text and number cells, shaded worked-out columns, a total row, remove per row. */
export function Editor<R extends { id: string }>({ title, rows, cols, onChange, make, addLabel, emptyLabel, readOnly, testId }: {
  title: string; rows: R[]; cols: Col<R>[]; onChange: (rows: R[]) => void; make: () => R; addLabel: string; emptyLabel: string; readOnly?: boolean; testId?: string;
}) {
  const { t } = usePlanT();
  const set = (i: number, k: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const hasTotal = cols.some((c) => c.total !== undefined);
  return (
    <section className="rounded-xl border border-line bg-white p-4" data-testid={testId}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <h3 className="t-card">{title}</h3>
        {!readOnly && rows.length > 0 && <button type="button" onClick={() => onChange([...rows, make()])} className="inline-flex items-center gap-1 rounded border border-line px-2.5 py-1 text-[13px] hover:border-brand" data-testid={testId && `${testId}-add`}><Plus className="h-3.5 w-3.5" />{addLabel}</button>}
      </header>
      {rows.length === 0 ? (
        readOnly ? <p className="text-sm text-mute">{emptyLabel}</p> :
          <button type="button" onClick={() => onChange([make()])} className="w-full rounded-lg border-2 border-dashed border-line py-6 text-sm text-mute hover:border-brand hover:text-ink" data-testid={testId && `${testId}-first`}>+ {emptyLabel}</button>
      ) : (
        <div className="overflow-x-auto" role="region" aria-label={title} tabIndex={0}>
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead><tr className="border-b border-line text-start text-[11px] uppercase tracking-wide text-mute">
              {cols.map((c) => <th key={c.key} scope="col" className={cn("px-1.5 py-1.5 font-semibold", c.kind === "text" ? "text-start" : "text-end")} style={{ width: c.width }}>{c.label}</th>)}
              {!readOnly && <th className="w-8" aria-label={t("Remove")} />}
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-b border-line/60 align-top">
                  {cols.map((c) => (
                    <td key={c.key} className={cn("px-1.5 py-1", c.kind === "calc" && "whitespace-nowrap bg-band/60 text-end num")} style={{ minWidth: c.kind === "text" ? 160 : c.kind === "num" ? 104 : 96 }}>
                      {c.kind === "text" ? (
                        <input aria-label={c.label} disabled={readOnly} value={String((r as Record<string, unknown>)[c.key] ?? "")} onChange={(e) => set(i, c.key, e.target.value)}
                          className="w-full rounded border border-line bg-white px-2 py-1 focus:border-brand focus:outline-none disabled:bg-band" />
                      ) : c.kind === "num" ? (
                        <NumIn label={c.label} disabled={readOnly} value={Number((r as Record<string, unknown>)[c.key] ?? 0)} suffix={c.suffix} min={c.min} onChange={(v) => set(i, c.key, v)} />
                      ) : c.calc?.(r)}
                      {c.hint && <div className="mt-0.5 text-end text-[11px] text-mute">{c.hint(r)}</div>}
                    </td>
                  ))}
                  {!readOnly && <td className="px-1 py-1"><button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`${t("Remove")} ${String((r as Record<string, unknown>).name ?? "")}`} className="rounded p-1 text-mute hover:bg-band hover:text-red"><X className="h-3.5 w-3.5" /></button></td>}
                </tr>
              ))}
            </tbody>
            {hasTotal && <tfoot><tr className="border-t-2 border-ink/60 font-semibold">{cols.map((c, i) => <td key={c.key} className={cn("px-1.5 py-1.5", c.kind === "text" ? "text-start" : "text-end num")}>{i === 0 ? t("Total") : c.total ?? ""}</td>)}{!readOnly && <td />}</tr></tfoot>}
          </table>
        </div>
      )}
    </section>
  );
}

/** Keeps the latest value of a fast-changing input for a moment (sliders), so the whole plan isn't re-projected per pixel. */
export function useSettled<T>(v: T, ms = 150) {
  const [s, setS] = useState(v);
  useEffect(() => { const h = setTimeout(() => setS(v), ms); return () => clearTimeout(h); }, [v, ms]);
  return s;
}
