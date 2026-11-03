"use client";
import { Fragment, useMemo, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { changeBadge, sortRows, type Sort, type SortKey } from "@/lib/engine/budget-visual";
import { useCompany } from "@/lib/company/context";
import { parseBudgetInput, rowMonths, type BaseCol, type Basis, type BudgetRow } from "@/lib/engine/budget-builder";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";
import { amt, Amt, ChangeBadge, ShareBar, TwoSpark, useCompact } from "./budget-visuals";

const r2 = (x: number) => Math.round(x * 100) / 100;
export const sumOf = (m: number[]) => r2(m.reduce((t, v) => t + v, 0));
export { amt };
const zeros = () => Array<number>(12).fill(0);
export const baseOf = (bases: Map<string, BaseCol>, r: { key: string; label: string }): BaseCol =>
  bases.get(r.key) ?? { key: r.key, label: r.label, years: [], ytd: 0, estimate: 0, months: zeros(), lastYear: zeros() };
/** The row after a yearly entry: back to mode "year", months spread from the basis. */
export const withBasis = (row: BudgetRow, basis: Basis, base: BaseCol): BudgetRow => ({ ...row, basis, mode: "year", months: rowMonths(basis, base) });
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); };
const box = "rounded border border-line bg-white px-1.5 py-1 text-end text-[13px] focus:border-brand-d";
const cell = `${box} w-24 sm:w-28`;
const SORTS: SortKey[] = ["name", "amount", "change"];
/** Inputs show the compact amount at rest and the exact one while focused; `same` tells an untouched box. */
const focusExact = (v: number) => (e: React.FocusEvent<HTMLInputElement>) => { e.target.value = amt(v); e.target.select(); };

export interface BudgetSheetProps {
  rows: BudgetRow[];
  bases: Map<string, BaseCol>;
  editable: boolean;
  onChange: (rows: BudgetRow[]) => void;
  /** The budget year's months ("YYYY-MM"), for the month labels. */
  months: string[];
  labelOf?: (r: BudgetRow) => string;
  /** Names listed under a row, read-only (what is in Others). */
  members?: Map<string, string[]>;
  /** Offer units × price on rows whose base has a price (revenue items). */
  units?: boolean;
  /** "Back to auto" for this view (default: the row's basis spread again). */
  auto?: (row: BudgetRow, base: BaseCol) => BudgetRow;
  /** Cost rows (expenses): an increase is bad. */
  cost?: boolean;
  /** Show each row's share of the total (revenue rows). */
  share?: boolean;
}

/** One view of the budget: prior years, this year to date, this year's estimate, change and the new year per row. */
export function BudgetSheet({ rows, bases, editable, onChange, months, labelOf, members, units, auto, cost, share }: BudgetSheetProps) {
  const { d, ms } = useT();
  const b = d.bud.b;
  const fmt = useCompact();
  const cur = useCompany().settings.currency;
  const withCur = (label: string) => <>{label} <span className="normal-case">({cur})</span></>;
  const [sort, setSort] = useState<Sort | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [uxp, setUxp] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [applyText, setApplyText] = useState("");
  const [phoneKey, setPhoneKey] = useState<string | null>(null);

  const toggle = (s: Set<string>, k: string) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const label = (r: BudgetRow) => labelOf?.(r) ?? r.label;
  const set = (next: BudgetRow) => onChange(rows.map((r) => (r.key === next.key ? next : r)));
  const years = [...new Set(rows.flatMap((r) => baseOf(bases, r).years.map((y) => y.fy)))].sort();
  const yearOf = (base: BaseCol, fy: string) => base.years.find((y) => y.fy === fy)?.amount ?? 0;
  const tot = {
    years: years.map((fy) => rows.reduce((t, r) => t + yearOf(baseOf(bases, r), fy), 0)),
    ytd: rows.reduce((t, r) => t + baseOf(bases, r).ytd, 0),
    est: rows.reduce((t, r) => t + baseOf(bases, r).estimate, 0),
    now: rows.reduce((t, r) => t + sumOf(r.months), 0),
  };
  const openMonths = (k: string) => (isPhone() ? setPhoneKey(k) : setOpen((s) => toggle(s, k)));
  const backToAuto = (r: BudgetRow) => {
    const base = baseOf(bases, r);
    set(auto ? auto(r, base) : withBasis(r, r.basis ?? { kind: "pct", value: 0 }, base));
  };
  function applyPct() {
    const p = parseBudgetInput(applyText.replace(/%|٪/g, ""));
    if (!p || p.kind !== "amount" || !sel.size) return;
    onChange(rows.map((r) => (sel.has(r.key) ? withBasis(r, { kind: "pct", value: p.value }, baseOf(bases, r)) : r)));
    setSel(new Set());
    setApplyText("");
  }
  const phoneRow = rows.find((r) => r.key === phoneKey) ?? null;
  const hideSm = "hidden sm:table-cell";
  const hideMd = "hidden md:table-cell";
  const searchable = rows.length > 15;
  const list = useMemo(() => {
    const q = searchable ? query.trim().toLocaleLowerCase() : "";
    const hit = q ? rows.filter((r) => (labelOf?.(r) ?? r.label).toLocaleLowerCase().includes(q)) : rows;
    return sortRows(hit, sort, {
      name: (r) => labelOf?.(r) ?? r.label,
      amount: (r) => sumOf(r.months),
      change: (r) => changeBadge(sumOf(r.months), baseOf(bases, r).estimate).pct,
    });
  }, [rows, sort, query, searchable, labelOf, bases]);
  const pick = (by: SortKey) => setSort((s) => (s?.by === by ? { by, desc: !s.desc } : { by, desc: by !== "name" }));

  return (
    <div data-testid="bsheet">
      {editable && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="bsheet-apply" className="text-mute">{b.applyPct}</label>
          <input id="bsheet-apply" inputMode="decimal" className="w-20 rounded border border-line px-2 py-1" value={applyText} onChange={(e) => setApplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyPct(); }} placeholder="+10" data-testid="bsheet-apply-pct" />
          <button type="button" className="rounded border border-line px-3 py-1 disabled:opacity-50" disabled={!sel.size} onClick={applyPct} data-testid="bsheet-apply-pct-ok">{b.apply}</button>
          {sel.size > 0 && <span className="text-xs text-mute">{b.selected(sel.size)}</span>}
          <span className="text-xs text-mute sm:ms-auto">{b.inputHint}</span>
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-mute" id="bsheet-sortby">{b.sortBy}</span>
        <div role="group" aria-labelledby="bsheet-sortby" className="flex gap-1">
          {SORTS.map((k) => (
            <button key={k} type="button" aria-pressed={sort?.by === k} onClick={() => pick(k)} data-testid={`bsheet-sort-${k}`}
              className={cn("inline-flex items-center gap-1 rounded border px-2 py-1", sort?.by === k ? "border-brand-d bg-band font-medium" : "border-line")}>
              {b.sort[k]}{sort?.by === k && (sort.desc ? <ArrowDown aria-hidden className="h-3 w-3" /> : <ArrowUp aria-hidden className="h-3 w-3" />)}
            </button>
          ))}
        </div>
        <span className="hidden items-center gap-1.5 text-mute md:inline-flex" data-testid="bsheet-trend-legend">
          <i aria-hidden className="inline-block h-0.5 w-3 rounded bg-[#b8c4c4]" />{b.trendLast}
          <i aria-hidden className="ms-2 inline-block h-0.5 w-3 rounded bg-[#2a78d6]" />{b.trendNew}
        </span>
        {searchable && (
          <label className="relative ms-auto flex items-center">
            <span className="sr-only">{b.search}</span>
            <Search aria-hidden className="pointer-events-none absolute start-2 h-3.5 w-3.5 text-mute" />
            <input type="search" className="w-44 rounded border border-line py-1 pe-2 ps-7 text-[13px]" placeholder={b.search} value={query} onChange={(e) => setQuery(e.target.value)} data-testid="bsheet-search" />
          </label>
        )}
      </div>
      <p className="mb-1 text-xs text-mute sm:hidden">{b.phoneHint}</p>
      <div className="max-h-[70vh] overflow-auto rounded border border-line">
        <table className="tbl w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              <th>{b.name}</th>
              {years.map((fy) => <th key={fy} className={hideSm}>{withCur(d.bud.fy(fy))}</th>)}
              <th className={hideMd}>{withCur(b.ytd)}</th><th className="!whitespace-normal">{withCur(b.estimate)}</th><th className="!whitespace-normal">{withCur(b.newYear)}</th><th className={hideSm}>{b.change}</th>
              <th className={hideMd} title={b.trendLegend}>{b.trend}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const base = baseOf(bases, r);
              const now = sumOf(r.months);
              const inside = members?.get(r.key) ?? [];
              const priced = units && !!base.price && base.price > 0;
              const showUxp = priced && (r.basis?.kind === "units" || uxp.has(r.key));
              const span = 1 + years.length + 5;
              return (
                <Fragment key={r.key}>
                  <tr data-testid={`bsheet-row-${r.key}`}>
                    <td className="min-w-[7rem] max-w-[10rem] sm:min-w-[12rem] sm:max-w-none">
                      <div className="flex items-center gap-1">
                        {editable && <input type="checkbox" className="h-4 w-4 shrink-0 accent-brand-d" aria-label={b.select(label(r))} checked={sel.has(r.key)}
                          onChange={() => setSel((s) => toggle(s, r.key))} data-testid={`bsheet-select-${r.key}`} />}
                        <button type="button" className="rounded p-0.5 text-mute hover:bg-band" aria-expanded={open.has(r.key)} aria-label={open.has(r.key) ? b.closeMonths : b.openMonths}
                          onClick={() => openMonths(r.key)} data-testid={`bsheet-open-${r.key}`}>
                          {open.has(r.key) ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4 rtl:rotate-180" />}
                        </button>
                        <span className="min-w-0 flex-1 truncate sm:cursor-auto" onClick={() => { if (isPhone()) setPhoneKey(r.key); }}>{label(r)}</span>
                        {r.mode === "months" && <span className="hidden whitespace-nowrap rounded bg-band px-1.5 text-[11px] text-mute sm:inline">{b.byMonths}</span>}
                        {inside.length > 0 && <button type="button" className="hidden text-xs text-brand-d underline sm:inline" onClick={() => setShown((s) => toggle(s, r.key))} data-testid={`bsheet-members-${r.key}`}>{b.showMembers}</button>}
                      </div>
                      {share && tot.now > 0 && <ShareBar share={now / tot.now} />}
                    </td>
                    {years.map((fy) => <td key={fy} className={hideSm}><Amt v={yearOf(base, fy)} /></td>)}
                    <td className={hideMd}><Amt v={base.ytd} /></td>
                    <td><Amt v={base.estimate} /></td>
                    <td className="p-0.5">
                      {editable ? (
                        <div className="flex flex-col items-end gap-1">
                          <input key={`${r.key}:${now}`} inputMode="decimal" className={cell} defaultValue={fmt(now)} aria-label={b.newYearOf(label(r))} title={`${amt(now)} · ${b.inputHint}`}
                            onKeyDown={onEnter} onFocus={focusExact(now)} data-testid={`bsheet-input-${r.key}`}
                            onBlur={(e) => {
                              const text = e.target.value;
                              e.target.value = fmt(now);
                              if (text === amt(now) || text === fmt(now)) return;
                              const basis = parseBudgetInput(text);
                              if (basis) set(withBasis(r, basis, base));
                            }} />
                          {priced && !showUxp && <button type="button" className="text-[11px] text-brand-d underline" onClick={() => setUxp((s) => toggle(s, r.key))} data-testid={`bsheet-uxp-${r.key}`}>{b.uxp}</button>}
                          {showUxp && <UnitsPrice row={r} base={base} onSet={set} />}
                        </div>
                      ) : (
                        <span className="flex flex-col items-end"><Amt v={now} testId={`bsheet-value-${r.key}`} />{r.basis?.kind === "units" && <span className="block text-[11px] text-mute">{amt(r.basis.units)} × {amt(r.basis.price)}</span>}
                          <ChangeBadge now={now} est={base.estimate} cost={cost} className="mt-0.5 sm:hidden" /></span>
                      )}
                      {editable && <div className="mt-0.5 flex justify-end sm:hidden"><ChangeBadge now={now} est={base.estimate} cost={cost} /></div>}
                    </td>
                    <td className={hideSm} data-testid={`bsheet-change-${r.key}`}><ChangeBadge now={now} est={base.estimate} cost={cost} /></td>
                    <td className={cn(hideMd, "py-0.5")} title={b.trendOf(label(r))}><TwoSpark last={base.lastYear} now={r.months} /></td>
                  </tr>
                  {shown.has(r.key) && (
                    <tr data-testid={`bsheet-memberlist-${r.key}`}><td colSpan={span} className="bg-band/50 text-xs text-mute">{inside.join(" · ")}</td></tr>
                  )}
                  {open.has(r.key) && (
                    <tr className="hidden sm:table-row"><td colSpan={span} className="bg-band/40">
                      <Months row={r} months={months} ms={ms} editable={editable} onSet={set} onAuto={() => backToAuto(r)} />
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
            {!list.length && <tr><td colSpan={6 + years.length} className="text-mute">{rows.length ? b.noMatch : b.empty}</td></tr>}
          </tbody>
          <tfoot className="sticky bottom-0 z-10 bg-white">
            <tr className="tot" data-testid="bsheet-total">
              <td>{b.total}</td>
              {tot.years.map((v, i) => <td key={years[i]} className={hideSm}><Amt v={v} /></td>)}
              <td className={hideMd}><Amt v={tot.ytd} /></td><td><Amt v={tot.est} /></td>
              <td><Amt v={tot.now} testId="bsheet-total-new" /></td>
              <td className={hideSm}><ChangeBadge now={tot.now} est={tot.est} cost={cost} /></td>
              <td className={hideMd} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Phone: a row's months in a bottom sheet (the Radix dialog the app's Dialog is built on). */}
      <D.Root open={!!phoneRow} onOpenChange={(o) => { if (!o) setPhoneKey(null); }}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <D.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-auto rounded-t-xl bg-white p-4 shadow-2xl outline-none" data-testid="bsheet-phone">
            <D.Title className="mb-2 pe-8 font-medium">{phoneRow ? label(phoneRow) : ""}</D.Title>
            <D.Description className="sr-only">{b.openMonths}</D.Description>
            {phoneRow && (() => {
              const base = baseOf(bases, phoneRow);
              return <>
                <p className="mb-2 flex flex-wrap items-center gap-1 text-sm text-mute">{b.estimate}: <Amt v={base.estimate} /> · {b.newYear}: <Amt v={sumOf(phoneRow.months)} className="text-ink" />
                  <ChangeBadge now={sumOf(phoneRow.months)} est={base.estimate} cost={cost} /></p>
                <Months row={phoneRow} months={months} ms={ms} editable={editable} onSet={set} onAuto={() => backToAuto(phoneRow)} />
              </>;
            })()}
            <D.Close className="absolute end-3 top-3 rounded p-1.5 text-mute hover:bg-band" aria-label={b.close}><X className="h-5 w-5" /></D.Close>
          </D.Content>
        </D.Portal>
      </D.Root>
    </div>
  );
}

/** A month box: a label around its input when editable, else a plain box (its amount is a button of its own). */
const Cell = ({ editable, className, children }: { editable: boolean; className: string; children: React.ReactNode }) =>
  editable ? <label className={className}>{children}</label> : <div className={className}>{children}</div>;

/** The 12 months of one row; typing in one sets the row to months (the year is their sum). */
function Months({ row, months, ms, editable, onSet, onAuto }: {
  row: BudgetRow; months: string[]; ms: (p: string) => string; editable: boolean; onSet: (r: BudgetRow) => void; onAuto: () => void;
}) {
  const { d } = useT();
  const b = d.bud.b;
  const fmt = useCompact();
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
        {row.months.map((v, i) => (
          <Cell key={i} editable={editable} className="grid gap-0.5 text-[11px] text-mute">
            {months[i] ? ms(months[i]) : i + 1}
            {editable ? (
              <input key={`${i}:${v}`} inputMode="decimal" className={cn(box, "w-full")} defaultValue={fmt(v)} title={amt(v)} onKeyDown={onEnter} onFocus={focusExact(v)} data-testid={`bsheet-month-${row.key}-${i}`}
                onBlur={(e) => {
                  const text = e.target.value;
                  e.target.value = fmt(v);
                  if (text === amt(v) || text === fmt(v)) return;
                  const p = parseBudgetInput(text);
                  if (!p || p.kind === "units") return;
                  const next = row.months.slice();
                  next[i] = r2(p.kind === "amount" ? p.value : v * (1 + p.value / 100));
                  onSet({ ...row, mode: "months", basis: { kind: "amount", value: sumOf(next) }, months: next });
                }} />
            ) : <Amt v={v} className="justify-self-end text-[13px] text-ink" testId={`bsheet-mval-${row.key}-${i}`} />}
          </Cell>
        ))}
      </div>
      {editable && row.mode === "months" && (
        <button type="button" className="self-start rounded border border-line px-2 py-1 text-xs" title={b.autoHint} onClick={onAuto} data-testid={`bsheet-auto-${row.key}`}>{b.auto}</button>
      )}
    </div>
  );
}

/** Units × price boxes: the row's year becomes units × price, spread over the months. */
function UnitsPrice({ row, base, onSet }: { row: BudgetRow; base: BaseCol; onSet: (r: BudgetRow) => void }) {
  const { d } = useT();
  const b = d.bud.b;
  const start = row.basis?.kind === "units" ? row.basis : { units: base.units ?? (base.price ? Math.round(base.estimate / base.price) : 0), price: base.price ?? 0 };
  const [u, setU] = useState(amt(start.units));
  const [p, setP] = useState(String(start.price));
  const commit = (uText: string, pText: string) => {
    const a = parseBudgetInput(uText), c = parseBudgetInput(pText);
    if (a?.kind !== "amount" || c?.kind !== "amount") return;
    if (row.basis?.kind === "units" && row.basis.units === a.value && row.basis.price === c.value) return;
    onSet(withBasis(row, { kind: "units", units: a.value, price: c.value }, base));
  };
  return (
    <div className="flex items-center gap-1 text-[11px] text-mute">
      <input inputMode="decimal" className={cn(box, "w-16")} aria-label={b.units} title={b.units} value={u} onChange={(e) => setU(e.target.value)} onKeyDown={onEnter}
        onBlur={() => commit(u, p)} data-testid={`bsheet-units-${row.key}`} />
      <span aria-hidden>×</span>
      <input inputMode="decimal" className={cn(box, "w-20")} aria-label={b.price} title={b.price} value={p} onChange={(e) => setP(e.target.value)} onKeyDown={onEnter}
        onBlur={() => commit(u, p)} data-testid={`bsheet-price-${row.key}`} />
    </div>
  );
}
