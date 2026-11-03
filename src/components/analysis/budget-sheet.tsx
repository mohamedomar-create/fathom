"use client";
import { Fragment, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { num, pct } from "@/lib/engine/format";
import { parseBudgetInput, rowMonths, type BaseCol, type Basis, type BudgetRow } from "@/lib/engine/budget-builder";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

const r2 = (x: number) => Math.round(x * 100) / 100;
export const sumOf = (m: number[]) => r2(m.reduce((t, v) => t + v, 0));
/** A whole amount with thousands commas (the app's number format, the same in both languages). */
export const amt = (v: number) => num(Math.round(v), "num").replace(/\.00$/, "");
const zeros = () => Array<number>(12).fill(0);
export const baseOf = (bases: Map<string, BaseCol>, r: { key: string; label: string }): BaseCol =>
  bases.get(r.key) ?? { key: r.key, label: r.label, years: [], ytd: 0, estimate: 0, months: zeros(), lastYear: zeros() };
/** The row after a yearly entry: back to mode "year", months spread from the basis. */
export const withBasis = (row: BudgetRow, basis: Basis, base: BaseCol): BudgetRow => ({ ...row, basis, mode: "year", months: rowMonths(basis, base) });
const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px)").matches;
const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") e.currentTarget.blur(); };
const box = "rounded border border-line bg-white px-1.5 py-1 text-end text-[13px] focus:border-brand-d";
const cell = `${box} w-24 sm:w-28`;

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
}

/** One view of the budget: prior years, this year to date, this year's estimate, change and the new year per row. */
export function BudgetSheet({ rows, bases, editable, onChange, months, labelOf, members, units, auto }: BudgetSheetProps) {
  const { d, ms } = useT();
  const b = d.bud.b;
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
  const change = (now: number, est: number) => (est !== 0 ? pct(((now - est) / Math.abs(est)) * 100, 1) : "–");
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
      <p className="mb-1 text-xs text-mute sm:hidden">{b.phoneHint}</p>
      <div className="max-h-[70vh] overflow-auto rounded border border-line">
        <table className="tbl w-full text-[13px]">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              <th>{b.name}</th>
              {years.map((fy) => <th key={fy} className={hideSm}>{d.bud.fy(fy)}</th>)}
              <th className={hideSm}>{b.ytd}</th><th className="!whitespace-normal">{b.estimate}</th><th className={hideSm}>{b.change}</th><th className="!whitespace-normal">{b.newYear}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const base = baseOf(bases, r);
              const now = sumOf(r.months);
              const list = members?.get(r.key) ?? [];
              const priced = units && !!base.price && base.price > 0;
              const showUxp = priced && (r.basis?.kind === "units" || uxp.has(r.key));
              const span = 1 + years.length + 4;
              return (
                <Fragment key={r.key}>
                  <tr data-testid={`bsheet-row-${r.key}`}>
                    <td className="min-w-[7rem] sm:min-w-[12rem]">
                      <div className="flex items-center gap-1">
                        {editable && <input type="checkbox" className="h-4 w-4 shrink-0 accent-brand-d" aria-label={b.select(label(r))} checked={sel.has(r.key)}
                          onChange={() => setSel((s) => toggle(s, r.key))} data-testid={`bsheet-select-${r.key}`} />}
                        <button type="button" className="rounded p-0.5 text-mute hover:bg-band" aria-expanded={open.has(r.key)} aria-label={open.has(r.key) ? b.closeMonths : b.openMonths}
                          onClick={() => openMonths(r.key)} data-testid={`bsheet-open-${r.key}`}>
                          {open.has(r.key) ? <ChevronDown aria-hidden className="h-4 w-4" /> : <ChevronRight aria-hidden className="h-4 w-4 rtl:rotate-180" />}
                        </button>
                        <span className="min-w-0 flex-1 truncate sm:cursor-auto" onClick={() => { if (isPhone()) setPhoneKey(r.key); }}>{label(r)}</span>
                        {r.mode === "months" && <span className="rounded bg-band px-1.5 text-[11px] text-mute">{b.byMonths}</span>}
                        {list.length > 0 && <button type="button" className="hidden text-xs text-brand-d underline sm:inline" onClick={() => setShown((s) => toggle(s, r.key))} data-testid={`bsheet-members-${r.key}`}>{b.showMembers}</button>}
                      </div>
                    </td>
                    {years.map((fy) => <td key={fy} className={hideSm}>{amt(yearOf(base, fy))}</td>)}
                    <td className={hideSm}>{amt(base.ytd)}</td>
                    <td>{amt(base.estimate)}</td>
                    <td className={hideSm} data-testid={`bsheet-change-${r.key}`}>{change(now, base.estimate)}</td>
                    <td className="p-0.5">
                      {editable ? (
                        <div className="flex flex-col items-end gap-1">
                          <input key={`${r.key}:${now}`} inputMode="decimal" className={cell} defaultValue={amt(now)} aria-label={b.newYearOf(label(r))} title={b.inputHint}
                            onKeyDown={onEnter} data-testid={`bsheet-input-${r.key}`}
                            onBlur={(e) => {
                              if (e.target.value === e.target.defaultValue) return;
                              const basis = parseBudgetInput(e.target.value);
                              if (!basis) { e.target.value = e.target.defaultValue; return; }
                              set(withBasis(r, basis, base));
                            }} />
                          {priced && !showUxp && <button type="button" className="text-[11px] text-brand-d underline" onClick={() => setUxp((s) => toggle(s, r.key))} data-testid={`bsheet-uxp-${r.key}`}>{b.uxp}</button>}
                          {showUxp && <UnitsPrice row={r} base={base} onSet={set} />}
                        </div>
                      ) : (
                        <span data-testid={`bsheet-value-${r.key}`}>{amt(now)}{r.basis?.kind === "units" && <span className="block text-[11px] text-mute">{amt(r.basis.units)} × {amt(r.basis.price)}</span>}</span>
                      )}
                    </td>
                  </tr>
                  {shown.has(r.key) && (
                    <tr data-testid={`bsheet-memberlist-${r.key}`}><td colSpan={span} className="bg-band/50 text-xs text-mute">{list.join(" · ")}</td></tr>
                  )}
                  {open.has(r.key) && (
                    <tr className="hidden sm:table-row"><td colSpan={span} className="bg-band/40">
                      <Months row={r} months={months} ms={ms} editable={editable} onSet={set} onAuto={() => backToAuto(r)} />
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && <tr><td colSpan={5 + years.length} className="text-mute">{b.empty}</td></tr>}
          </tbody>
          <tfoot className="sticky bottom-0 z-10 bg-white">
            <tr className="tot" data-testid="bsheet-total">
              <td>{b.total}</td>
              {tot.years.map((v, i) => <td key={years[i]} className={hideSm}>{amt(v)}</td>)}
              <td className={hideSm}>{amt(tot.ytd)}</td><td>{amt(tot.est)}</td><td className={hideSm}>{change(tot.now, tot.est)}</td>
              <td data-testid="bsheet-total-new">{amt(tot.now)}</td>
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
                <p className="mb-2 text-sm text-mute">{b.estimate}: {amt(base.estimate)} · {b.newYear}: {amt(sumOf(phoneRow.months))}</p>
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

/** The 12 months of one row; typing in one sets the row to months (the year is their sum). */
function Months({ row, months, ms, editable, onSet, onAuto }: {
  row: BudgetRow; months: string[]; ms: (p: string) => string; editable: boolean; onSet: (r: BudgetRow) => void; onAuto: () => void;
}) {
  const { d } = useT();
  const b = d.bud.b;
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
        {row.months.map((v, i) => (
          <label key={i} className="grid gap-0.5 text-[11px] text-mute">
            {months[i] ? ms(months[i]) : i + 1}
            {editable ? (
              <input key={`${i}:${v}`} inputMode="decimal" className={cn(box, "w-full")} defaultValue={amt(v)} onKeyDown={onEnter} data-testid={`bsheet-month-${row.key}-${i}`}
                onBlur={(e) => {
                  if (e.target.value === e.target.defaultValue) return;
                  const p = parseBudgetInput(e.target.value);
                  if (!p || p.kind === "units") { e.target.value = e.target.defaultValue; return; }
                  const next = row.months.slice();
                  next[i] = r2(p.kind === "amount" ? p.value : v * (1 + p.value / 100));
                  onSet({ ...row, mode: "months", basis: { kind: "amount", value: sumOf(next) }, months: next });
                }} />
            ) : <span className="text-end text-[13px] text-ink" data-testid={`bsheet-mval-${row.key}-${i}`}>{amt(v)}</span>}
          </label>
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
