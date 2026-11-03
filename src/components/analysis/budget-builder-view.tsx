"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { money } from "@/lib/engine";
import { fyMonths, type BudgetLine } from "@/lib/engine/budget";
import {
  balanceCustomers, budgetToLines, customerView, groupView, streamView, type BaseCol, type BudgetRow, type BudgetSetup,
} from "@/lib/engine/budget-builder";
import { builderBases, startRows, type BuilderBases, type BuilderData } from "@/lib/engine/budget-bases";
import { emptySetup, setupDrift } from "@/lib/engine/budget-setup";
import type { SalesCustomerRow, SalesProductRow } from "@/lib/engine/sales";
import type { ExpenseAccountRow } from "@/lib/engine/expenses";
import type { BudgetVersionInfo } from "@/lib/company/budget-load";
import { useCompany } from "@/lib/company/context";
import { saveBudgetRows } from "@/app/company/[id]/analysis/budget-actions";
import { amt, baseOf, BudgetSheet, sumOf } from "./budget-sheet";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

const VIEWS = ["revenue", "customer", "expense"] as const;
const TABS = ["revenue", "customers", "streams", "groups", "expenses", "vs"] as const;
type Tab = (typeof TABS)[number];
const r2 = (x: number) => Math.round(x * 100) / 100;
const monthsSum = (rows: BudgetRow[]) => Array.from({ length: 12 }, (_, i) => r2(rows.reduce((t, r) => t + (r.months[i] ?? 0), 0)));
const INCOME = new Set<string>(["other_income", "interest_income"]);

/** Rows as saved (labels within the stored limit). */
const forSave = (r: BudgetRow): BudgetRow => ({ ...r, label: r.label.slice(0, 200) });

/** The rows a version starts the screen with: its saved rows per view (expense rows get their class), else from the setup. */
function initialRows(saved: BudgetRow[], bb: BuilderBases): Record<(typeof VIEWS)[number], BudgetRow[]> {
  const start = startRows(bb);
  const cls = new Map(bb.expense.map((e) => [e.key, e.cls]));
  // Saved rows come back by key; show them in the base order (setup order, then the biggest first), others after.
  const order = new Map([...bb.revenue, ...bb.customer, ...bb.expense].map((x, i) => [x.key, i]));
  const at = (k: string) => order.get(k) ?? order.size;
  const pick = (v: (typeof VIEWS)[number]) => {
    const s = saved.filter((r) => r.view === v).sort((a, b) => at(a.key) - at(b.key));
    return s.length ? s : start.filter((r) => r.view === v);
  };
  return { revenue: pick("revenue"), customer: pick("customer"), expense: pick("expense").map((r) => ({ ...r, cls: r.cls ?? cls.get(r.key) ?? "exp_fixed" })) };
}

/** Builds the lines and a version's first rows from the setup (used when a version is made "From the setup"). */
export function buildFromSetup(data: BuilderData, setup: BudgetSetup, fy: string, fyStart: number) {
  const bb = builderBases(data, setup, fy, fyStart);
  const rows = startRows(bb).map(forSave);
  return { rows, lines: budgetToLines(rows, bb.byKey, fyMonths(fy, fyStart)), empty: !bb.revenue.length && !bb.expense.length };
}

/** Revenue, gross profit and net profit of the new year from the lines (cost of sales classes come off gross profit). */
function stripOf(lines: BudgetLine[]) {
  let revenue = 0, cos = 0, rest = 0;
  for (const l of lines) {
    if (l.cls === "revenue") revenue += l.amount;
    else if (l.cls.startsWith("cos_")) cos += l.amount;
    else rest += INCOME.has(l.cls) ? -l.amount : l.amount;
  }
  return { revenue, gp: revenue - cos, np: revenue - cos - rest };
}

export interface BuilderViewProps {
  version: BudgetVersionInfo;
  current: { rows: BudgetRow[]; setup: BudgetSetup | null };
  companySetup: BudgetSetup | null;
  salesProducts: SalesProductRow[];
  salesCustomers: SalesCustomerRow[];
  expenseAccounts: ExpenseAccountRow[];
  /** Cost-of-sales accounts that hold only stock cost-of-goods postings. */
  stockCogs: string[];
  editable: boolean;
  say: (ok: boolean, text: string) => void;
  onDirty: (n: number) => void;
  /** The Budget vs actual view for these lines. */
  renderVs: (lines: BudgetLine[]) => ReactNode;
}

/** The budget builder for one version: Revenue, Customers, Sales vs rental, By group, Expenses and Budget vs actual. */
export function BudgetBuilderView({ version, current, companySetup, salesProducts, salesCustomers, expenseAccounts, stockCogs, editable, say, onDirty, renderVs }: BuilderViewProps) {
  const c = useCompany();
  const router = useRouter();
  const { d } = useT();
  const t = d.bud;
  const b = t.b;
  const fyStart = c.settings.fyStartMonth ?? 1;
  const months = useMemo(() => fyMonths(version.fy, fyStart), [version.fy, fyStart]);
  const setup = current.setup ?? companySetup ?? emptySetup();
  const bb = useMemo(() => builderBases({ products: salesProducts, customers: salesCustomers, expenses: expenseAccounts, stockCogs }, setup, version.fy, fyStart),
    [salesProducts, salesCustomers, expenseAccounts, stockCogs, setup, version.fy, fyStart]);
  const [rows, setRows] = useState(() => initialRows(current.rows, bb));
  // Customers typed by hand (kept as typed); the others follow the revenue by their share.
  const [edited, setEdited] = useState(() => new Set(rows.customer.filter((r) => r.basis !== null).map((r) => r.key)));
  const [dirty, setDirty] = useState(0);
  const [tab, setTab] = useState<Tab>("revenue");
  const [pending, start] = useTransition();
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const bases = useMemo(() => {
    const m = new Map<string, BaseCol>(bb.byKey);
    for (const r of [...rows.revenue, ...rows.customer, ...rows.expense]) if (!m.has(r.key)) m.set(r.key, baseOf(m, r));
    return m;
  }, [bb, rows]);
  const revenueMonths = useMemo(() => monthsSum(rows.revenue), [rows.revenue]);
  const custBases = (list: BudgetRow[]) => list.map((r) => baseOf(bases, r));
  const reshare = (rev: number[], cust: BudgetRow[], keep: Set<string>) => customerView(rev, custBases(cust), cust.filter((r) => keep.has(r.key))).rows;

  const all = useMemo(() => [...rows.revenue, ...rows.customer, ...rows.expense], [rows]);
  const lines = useMemo(() => budgetToLines(all, bases, months), [all, bases, months]);
  const strip = useMemo(() => stripOf(lines), [lines]);
  const difference = useMemo(() => { const cs = monthsSum(rows.customer); return revenueMonths.map((v, i) => r2(v - cs[i])); }, [rows.customer, revenueMonths]);
  const diffYear = r2(difference.reduce((t, v) => t + v, 0));
  const off = difference.some((v) => Math.abs(v) >= 0.005);

  const changed = () => setDirty((n) => n + 1);
  function onRevenue(next: BudgetRow[]) {
    const rev = monthsSum(next);
    setRows((r) => ({ ...r, revenue: next, customer: r.customer.length ? reshare(rev, r.customer, edited) : r.customer }));
    changed();
  }
  function onCustomers(next: BudgetRow[]) {
    const keep = new Set(edited);
    let back = false;
    next.forEach((r, i) => {
      if (r === rows.customer[i]) return;
      if (r.basis === null) { keep.delete(r.key); back = true; } else keep.add(r.key);
    });
    setEdited(keep);
    setRows((r) => ({ ...r, customer: back ? reshare(revenueMonths, next, keep) : next }));
    changed();
  }
  function balance() {
    setRows((r) => ({ ...r, customer: balanceCustomers({ rows: r.customer, difference }, edited) }));
    changed();
  }
  function save() {
    start(async () => {
      const res = await saveBudgetRows(c.id, version.id, { rows: all.map(forSave), views: [...VIEWS], lines, setup: current.setup ?? companySetup });
      if (!res.ok) return say(false, res.error);
      setDirty(0);
      say(true, t.saved);
      router.refresh();
    });
  }

  const members = useMemo(() => new Map([...bb.members].filter(([k]) => k === "others").map(([k, v]) => [k, v.map((x) => x.product)])), [bb.members]);
  const labelOf = (r: BudgetRow) => (r.key === "others" ? b.others : r.label);
  const streams = useMemo(() => streamView(rows.revenue, setup, bb.members), [rows.revenue, setup, bb.members]);
  const groups = useMemo(() => groupView(rows.revenue, rows.customer, setup), [rows.revenue, rows.customer, setup]);
  const drift = !!companySetup && setupDrift(current.setup, companySetup);
  const sheet = { bases, editable, months };

  return (
    <div data-testid="budget-builder">
      {drift && <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm" data-testid="bsetup-drift">{b.drift}</p>}
      <div className="mb-3 grid grid-cols-3 gap-2 rounded border border-line p-3 text-sm" data-testid="bsheet-strip" title={b.stripNote}>
        {([["revenue", strip.revenue], ["gp", strip.gp], ["np", strip.np]] as const).map(([k, v]) => (
          <div key={k}><div className="text-xs text-mute">{b.strip[k]} · {t.fy(version.fy)}</div><div className={cn("text-lg tabular-nums", v < 0 && "text-red-d")} data-testid={`bsheet-strip-${k}`}>{money(v, c.settings.currency)}</div></div>
        ))}
      </div>
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} data-testid={`btab-${k}`}
            className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm", tab === k ? "border-brand-d font-medium" : "border-transparent text-mute")}>{b.tabs[k]}</button>
        ))}
      </div>

      {tab === "revenue" && <BudgetSheet {...sheet} rows={rows.revenue} onChange={onRevenue} labelOf={labelOf} members={members} units />}
      {tab === "customers" && <>
        {off && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm" data-testid="customer-diff" role="status">
            <span>{diffYear >= 0 ? b.custDiff(amt(Math.abs(diffYear))) : b.custDiffOver(amt(Math.abs(diffYear)))}</span>
            {editable && <button type="button" className="ms-auto rounded bg-brand-d px-3 py-1 text-white" title={b.balanceHint} onClick={balance} data-testid="customer-balance">{b.balance}</button>}
          </div>
        )}
        <BudgetSheet {...sheet} rows={rows.customer} onChange={onCustomers}
          auto={(r) => ({ ...r, mode: "year", basis: null })} />
      </>}
      {tab === "streams" && (
        <ViewTable testId="bstreams" note={b.streamsNote} months={months} rows={[{ id: "sales", name: b.sales, months: streams.sales }, { id: "rental", name: b.rental, months: streams.rental }]} total={revenueMonths} />
      )}
      {tab === "groups" && <>
        <ViewTable testId="bgroups" note={b.groupsNote} months={months} rows={groups.filter((g) => g.by === "products").map((g) => ({ ...g, name: g.id === "others" ? b.others : g.name }))} total={revenueMonths} />
        {groups.some((g) => g.by === "customers") && (
          <div className="mt-6">
            <h2 className="mb-1 font-medium">{b.custGroups}</h2>
            <ViewTable testId="bgroups-customers" note={b.custGroupsNote} months={months} rows={groups.filter((g) => g.by === "customers")} />
          </div>
        )}
      </>}
      {tab === "expenses" && bb.excluded.length > 0 && <p className="mb-2 text-xs text-mute" data-testid="bexp-cos-note">{b.cosNote(bb.excluded.join(", "))}</p>}
      {tab === "expenses" && <BudgetSheet {...sheet} rows={rows.expense} onChange={(next) => { setRows((r) => ({ ...r, expense: next })); changed(); }} />}
      {tab === "vs" && renderVs(lines)}

      {editable && dirty > 0 && (
        <div className="sticky bottom-16 mt-4 flex items-center gap-3 rounded border border-line bg-white p-3 shadow md:bottom-2">
          <span className="text-sm text-mute">{t.unsaved(dirty)}</span>
          <button type="button" disabled={pending} onClick={save} className="ms-auto rounded bg-brand-d px-4 py-2 text-sm font-medium text-white disabled:opacity-50" data-testid="budget-save">{t.save}</button>
        </div>
      )}
    </div>
  );
}

/** A read-only view of the revenue by month (sales vs rental, by group). */
function ViewTable({ testId, note, months, rows, total }: { testId: string; note: string; months: string[]; rows: { id: string; name: string; months: number[] }[]; total?: number[] }) {
  const { d, ms } = useT();
  const b = d.bud.b;
  return (
    <div data-testid={testId}>
      <p className="mb-2 text-xs text-mute">{note}</p>
      <div tabIndex={0} className="overflow-x-auto">
        <table className="tbl text-[13px]">
          <thead><tr><th className="text-start">{b.name}</th>{months.map((m) => <th key={m}>{ms(m)}</th>)}<th>{b.newYear}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-testid={`${testId}-row`}><td className="text-start">{r.name}</td>{r.months.map((v, i) => <td key={i}>{amt(v)}</td>)}<td className="font-medium">{amt(sumOf(r.months))}</td></tr>
            ))}
            {total && <tr className="tot"><td className="text-start">{b.total}</td>{total.map((v, i) => <td key={i}>{amt(v)}</td>)}<td>{amt(sumOf(total))}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
