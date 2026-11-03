"use client";
import { useMemo, useState, useTransition } from "react";
import { cleanSetup, suggestSetup, type RentalHint } from "@/lib/engine/budget-setup";
import type { BudgetSetup } from "@/lib/engine/budget-builder";
import type { SalesProductRow } from "@/lib/engine/sales";
import { saveBudgetSetup } from "@/app/company/[id]/analysis/budget-actions";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

const IGNORED = new Set(["", "No product"]);
export interface ExpenseChoice { key: string; label: string; amount: number }

export interface BudgetSetupWizardProps {
  companyId: string;
  /** This year's product rows. */
  products: SalesProductRow[];
  /** Distinct customer names, biggest first. */
  customers: string[];
  expenses: ExpenseChoice[];
  hints: RentalHint[];
  /** The saved setup; null starts from the suggestion. */
  initial: BudgetSetup | null;
  onDone: (setup: BudgetSetup) => void;
}

const toggle = (list: string[], v: string, on: boolean) => (on ? (list.includes(v) ? list : [...list, v]) : list.filter((x) => x !== v));

export function BudgetSetupWizard({ companyId, products, customers, expenses, hints, initial, onDone }: BudgetSetupWizardProps) {
  const { d } = useT();
  const w = d.bud.wiz;
  const [setup, setSetup] = useState<BudgetSetup>(() => initial ?? suggestSetup(products).setup);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [q, setQ] = useState("");
  const [gi, setGi] = useState(0);
  const [sel, setSel] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergeName, setMergeName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Every product by amount, biggest first (the order the lists show).
  const list = useMemo(() => {
    const tot = new Map<string, number>();
    for (const r of products) if (!IGNORED.has(r.r)) tot.set(r.r, (tot.get(r.r) ?? 0) + r.a);
    return [...tot].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).map(([name, amount]) => ({ name, amount }));
  }, [products]);
  const all = useMemo(() => products.reduce((t, r) => t + r.a, 0), [products]);
  const picked = new Set(setup.products);
  const covered = list.filter((p) => picked.has(p.name)).reduce((t, p) => t + p.amount, 0);
  const coverage = all !== 0 ? Math.round((covered / all) * 100) : 0;
  const needle = q.trim().toLowerCase();
  const shown = list.map((p, i) => ({ ...p, i })).filter((p) => !needle || p.name.toLowerCase().includes(needle));

  const set = (f: (s: BudgetSetup) => BudgetSetup) => setSetup((s) => f(s));
  const group = setup.groups[gi] as BudgetSetup["groups"][number] | undefined;
  const editGroup = (f: (g: BudgetSetup["groups"][number]) => BudgetSetup["groups"][number]) =>
    set((s) => ({ ...s, groups: s.groups.map((g, i) => (i === gi ? f(g) : g)) }));
  const addGroup = () => {
    const ids = new Set(setup.groups.map((g) => g.id));
    let n = setup.groups.length + 1;
    while (ids.has(`g${n}`)) n++;
    set((s) => ({ ...s, groups: [...s.groups, { id: `g${n}`, name: w.groupDefault(s.groups.length + 1), products: [], customers: [] }] }));
    setGi(setup.groups.length);
  };
  const removeGroup = () => { set((s) => ({ ...s, groups: s.groups.filter((_, i) => i !== gi) })); setGi(0); };

  const mergedKeys = new Set(setup.expenses.merged.flatMap((m) => m.accounts));
  const excluded = new Set(setup.expenses.excluded);
  const doMerge = () => {
    const name = mergeName.trim();
    if (!name || sel.length < 2) return;
    const ids = new Set(setup.expenses.merged.map((m) => m.id));
    let n = setup.expenses.merged.length + 1;
    while (ids.has(`m${n}`)) n++;
    set((s) => ({ ...s, expenses: { ...s.expenses, merged: [...s.expenses.merged, { id: `m${n}`, name, accounts: sel }] } }));
    setSel([]); setMergeName(""); setMerging(false);
  };

  function save() {
    setError(null);
    const clean = cleanSetup(setup);
    if (!clean) return setError(w.nameEmpty);
    start(async () => {
      const r = await saveBudgetSetup(companyId, clean);
      if (!r.ok) return setError(r.error);
      onDone(clean);
    });
  }

  const box = "h-4 w-4 shrink-0 accent-brand-d";
  const btn = "rounded border border-line px-3 py-1.5 text-sm disabled:opacity-50";
  const primary = "rounded bg-brand-d px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
  const row = "flex items-center gap-2 border-b border-line px-2 py-1.5 text-sm last:border-0";
  const scroll = "max-h-[44vh] overflow-auto rounded border border-line";

  return (
    <div className="p-6" data-testid="bsetup">
      <h2 className="mb-1 text-lg font-semibold">{w.title}</h2>
      <ol className="mb-4 flex flex-wrap gap-2 text-xs text-mute">
        {w.steps.map((s, i) => <li key={s} className={cn("rounded-full px-2.5 py-0.5", step === i + 1 ? "bg-brand-d text-white" : "bg-band")}>{i + 1}. {s}</li>)}
      </ol>

      {step === 1 && (
        <section data-testid="bsetup-step-1">
          <p className="mb-2 text-sm">{w.s1}</p>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={w.search} aria-label={w.search} data-testid="bsetup-search" className="mb-2 w-full rounded border border-line px-2 py-1.5 text-sm" />
          <p className="mb-2 text-sm font-medium" data-testid="bsetup-coverage">{w.coverage(picked.size, `${coverage}%`)}</p>
          <div className={scroll}>
            {shown.length === 0 && <p className="p-3 text-sm text-mute">{w.none}</p>}
            {shown.map((p) => (
              <label key={p.name} className={cn(row, "cursor-pointer")}>
                <input type="checkbox" className={box} checked={picked.has(p.name)} data-testid={`bsetup-product-${p.i}`}
                  onChange={(e) => set((s) => ({ ...s, products: toggle(s.products, p.name, e.target.checked) }))} />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="tabular-nums text-mute">{Math.round(p.amount).toLocaleString("en-US")}</span>
              </label>
            ))}
          </div>
        </section>
      )}

      {step === 2 && (
        <section data-testid="bsetup-step-2" className="grid gap-4">
          <p className="text-sm">{w.s2}</p>
          <div data-testid="bsetup-groups">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{w.groups}</h3>
              {setup.groups.map((g, i) => (
                <button key={g.id} type="button" onClick={() => setGi(i)} data-testid={`bsetup-group-${i}`}
                  className={cn("rounded-full border px-2.5 py-0.5 text-xs", i === gi ? "border-brand-d bg-brand-d text-white" : "border-line")}>{g.name}</button>
              ))}
              <button type="button" className={btn} onClick={addGroup} data-testid="bsetup-group-new">{w.newGroup}</button>
            </div>
            {group ? (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <input value={group.name} onChange={(e) => editGroup((g) => ({ ...g, name: e.target.value }))} aria-label={w.groupName} placeholder={w.groupName} data-testid="bsetup-group-name" className="min-w-0 flex-1 rounded border border-line px-2 py-1.5 text-sm" />
                  <button type="button" className={btn} onClick={removeGroup} data-testid="bsetup-group-remove">{w.removeGroup}</button>
                </div>
                <div className={scroll}>
                  {list.map((p, i) => (
                    <div key={`p${p.name}`} className={row}>
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input type="checkbox" className={box} checked={group.products.includes(p.name)} data-kind="product" data-testid={`bsetup-member-${i}`}
                          onChange={(e) => editGroup((g) => ({ ...g, products: toggle(g.products, p.name, e.target.checked) }))} />
                        <span className="rounded bg-band px-1.5 text-xs">{w.tagProduct}</span>
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-1 text-xs text-mute">
                        <input type="checkbox" className={box} checked={setup.streams.rental.includes(p.name)} data-testid={`bsetup-markrental-${i}`}
                          onChange={(e) => set((s) => ({ ...s, streams: { rental: toggle(s.streams.rental, p.name, e.target.checked) } }))} />
                        {w.markRental}
                      </label>
                    </div>
                  ))}
                  {customers.map((c, j) => (
                    <label key={`c${c}`} className={cn(row, "cursor-pointer")}>
                      <input type="checkbox" className={box} checked={group.customers.includes(c)} data-kind="customer" data-testid={`bsetup-member-${list.length + j}`}
                        onChange={(e) => editGroup((g) => ({ ...g, customers: toggle(g.customers, c, e.target.checked) }))} />
                      <span className="rounded bg-band px-1.5 text-xs">{w.tagCustomer}</span>
                      <span className="min-w-0 flex-1 truncate">{c}</span>
                    </label>
                  ))}
                </div>
              </>
            ) : <p className="text-sm text-mute">{w.noGroup}</p>}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">{w.rental}</h3>
            {hints.length === 0 ? <p className="text-sm text-mute">{w.rentalNone}</p> : (
              <div className={scroll}>
                {hints.map((h, i) => (
                  <label key={h.key} className={cn(row, "cursor-pointer")}>
                    <input type="checkbox" className={box} checked={setup.streams.rental.includes(h.key)} data-testid={`bsetup-rental-${i}`}
                      onChange={(e) => set((s) => ({ ...s, streams: { rental: toggle(s.streams.rental, h.key, e.target.checked) } }))} />
                    <span className="min-w-0 flex-1 truncate">{h.key.replace(/^acct:/, "")}</span>
                    <span className="text-xs text-mute">{w.reason[h.reason]}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {step === 3 && (
        <section data-testid="bsetup-step-3">
          <p className="mb-2 text-sm">{w.s3}</p>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <button type="button" className={btn} disabled={sel.length < 2} onClick={() => setMerging(true)} data-testid="bsetup-exp-merge">{w.merge}</button>
            {sel.length < 2 && <span className="text-xs text-mute">{w.pickTwo}</span>}
            {merging && (
              <>
                <input value={mergeName} onChange={(e) => setMergeName(e.target.value)} aria-label={w.mergeName} placeholder={w.mergeName} data-testid="bsetup-exp-name" className="min-w-0 flex-1 rounded border border-line px-2 py-1.5 text-sm" />
                <button type="button" className={primary} disabled={!mergeName.trim()} onClick={doMerge} data-testid="bsetup-exp-merge-ok">{w.mergeOk}</button>
                <button type="button" className={btn} onClick={() => setMerging(false)}>{w.mergeCancel}</button>
              </>
            )}
          </div>
          <div className={scroll}>
            {expenses.length === 0 && <p className="p-3 text-sm text-mute">{w.expNone}</p>}
            {expenses.map((e, i) => {
              const into = setup.expenses.merged.find((m) => m.accounts.includes(e.key));
              return (
                <div key={e.key} className={cn(row, excluded.has(e.key) && "text-mute line-through")}>
                  <input type="checkbox" className={box} aria-label={e.label} disabled={!!into || excluded.has(e.key)} checked={sel.includes(e.key)} data-testid={`bsetup-exp-select-${i}`}
                    onChange={(ev) => setSel((s) => toggle(s, e.key, ev.target.checked))} />
                  <span className="min-w-0 flex-1 truncate">{e.label}</span>
                  {into && <span className="text-xs text-mute no-underline">{w.mergedInto(into.name)}</span>}
                  <span className="tabular-nums text-mute">{Math.round(e.amount).toLocaleString("en-US")}</span>
                  {!into && (
                    <label className="flex cursor-pointer items-center gap-1 text-xs">
                      <input type="checkbox" className={box} checked={excluded.has(e.key)} data-testid={`bsetup-exp-exclude-${i}`}
                        onChange={(ev) => {
                          set((s) => ({ ...s, expenses: { ...s.expenses, excluded: toggle(s.expenses.excluded, e.key, ev.target.checked) } }));
                          if (ev.target.checked) setSel((s) => s.filter((k) => k !== e.key));
                        }} />
                      {w.exclude}
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {mergedKeys.size > 0 && (
            <ul className="mt-2 grid gap-1 text-sm">
              {setup.expenses.merged.map((m) => (
                <li key={m.id} className="flex items-center gap-2" data-testid="bsetup-merged">
                  <span className="font-medium">{m.name}</span><span className="text-mute">({m.accounts.length})</span>
                  <button type="button" className="text-xs text-brand-d underline" onClick={() => set((s) => ({ ...s, expenses: { ...s.expenses, merged: s.expenses.merged.filter((x) => x.id !== m.id) } }))}>{w.unmerge}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-red-d" data-testid="bsetup-error">{error}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" className={btn} disabled={step === 1 || pending} onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)} data-testid="bsetup-back">{w.back}</button>
        {step < 3
          ? <button type="button" className={primary} onClick={() => setStep((s) => (s + 1) as 1 | 2 | 3)} data-testid="bsetup-next">{w.next}</button>
          : <button type="button" className={primary} disabled={pending} onClick={save} data-testid="bsetup-save">{pending ? w.saving : w.save}</button>}
      </div>
    </div>
  );
}
