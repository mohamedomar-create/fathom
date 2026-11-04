"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { fyMonths, type BudgetLine } from "@/lib/engine/budget";
import {
  balanceCustomers, budgetToLines, customerView, expenseClass, groupView, isBudgetedExpense, streamView, type BaseCol, type BudgetRow, type BudgetSetup,
} from "@/lib/engine/budget-builder";
import { budgetTotals } from "@/lib/engine/budget-visual";
import { builderBases, startRows, versionRows, type BuilderData } from "@/lib/engine/budget-bases";
import { emptySetup, setupDrift } from "@/lib/engine/budget-setup";
import type { SalesCustomerRow, SalesProductRow } from "@/lib/engine/sales";
import { EXPENSE_GROUPS, isCostLine, type ExpenseAccountRow } from "@/lib/engine/expenses";
import type { BudgetVersionInfo } from "@/lib/company/budget-load";
import { useCompany } from "@/lib/company/context";
import { saveBudgetRows } from "@/app/company/[id]/analysis/budget-actions";
import { baseOf, BudgetSheet, sumOf } from "./budget-sheet";
import { Amt, BudgetCards, ChartCard, SplitBar, useCompact } from "./budget-visuals";
import { BarList, type BarItem } from "@/components/charts/bar-list";
import { ColumnChart } from "@/components/charts/column-chart";
import { ramp } from "@/components/viz/palette";
import { pct } from "@/lib/engine/format";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

const VIEWS = ["revenue", "customer", "expense"] as const;
const TABS = ["revenue", "customers", "streams", "groups", "expenses", "vs"] as const;
type Tab = (typeof TABS)[number];
const r2 = (x: number) => Math.round(x * 100) / 100;
const INCOME = new Set<string>(["other_income", "interest_income"]);
const monthsSum = (rows: BudgetRow[]) => Array.from({ length: 12 }, (_, i) => r2(rows.reduce((t, r) => t + (r.months[i] ?? 0), 0)));

/** Rows as saved (labels within the stored limit; an expense row keeps its class in `cost`: budget_rows has no cls column). */
const forSave = (r: BudgetRow): BudgetRow =>
  ({ ...r, label: r.label.slice(0, 200), ...(r.view === "expense" ? { cost: { kind: "expense" as const, cls: r.cls ?? "exp_fixed" } } : {}) });

/** Builds the lines and a version's first rows from the setup (used when a version is made "From the setup"). */
export function buildFromSetup(data: BuilderData, setup: BudgetSetup, fy: string, fyStart: number) {
  const bb = builderBases(data, setup, fy, fyStart);
  const rows = startRows(bb).map(forSave);
  return { rows, lines: budgetToLines(rows, fyMonths(fy, fyStart)), empty: !bb.revenue.length && !bb.expense.length };
}

/** Ranked bars with each item's share of `total` (Others, when there, last). */
const ranked = (items: { key: string; label: string; value: number }[], total: number): BarItem[] =>
  items.slice().sort((a, b) => (a.key === "others" ? 1 : b.key === "others" ? -1 : b.value - a.value))
    .map((x) => { const share = total ? (x.value / total) * 100 : 0; return { ...x, share, sub: pct(share, 1) }; });
/** A fixed colour per expense group (by the group, never its rank): the chart tokens, then the target purple. */
const GROUP_COLOR: Record<string, string> = Object.fromEntries(["cos", "fixed", "variable", "depreciation", "finance", "other"].map((k, i) => [k, ramp(6)[i]]));
const GROUP_OF_CLS = new Map(EXPENSE_GROUPS.flatMap((g) => g.classes.map((c) => [c as string, g] as const)));

export interface BuilderViewProps {
  version: BudgetVersionInfo;
  /** The version's saved rows, setup and lines (the lines are what was saved: shown until something is edited). */
  current: { rows: BudgetRow[]; setup: BudgetSetup | null; lines?: BudgetLine[] };
  companySetup: BudgetSetup | null;
  salesProducts: SalesProductRow[];
  salesCustomers: SalesCustomerRow[];
  expenseAccounts: ExpenseAccountRow[];
  /** Cost-of-sales accounts that hold only stock cost-of-goods postings. */
  stockCogs: string[];
  /** Cost-of-sales accounts that mix stock cost-of-goods postings with other lines. */
  mixedCogs?: string[];
  editable: boolean;
  say: (ok: boolean, text: string) => void;
  onDirty: (n: number) => void;
  /** The Budget vs actual view for these lines. */
  renderVs: (lines: BudgetLine[]) => ReactNode;
}

/** The budget builder for one version: Revenue, Customers, Sales vs rental, By group, Expenses and Budget vs actual. */
export function BudgetBuilderView({ version, current, companySetup, salesProducts, salesCustomers, expenseAccounts, stockCogs, mixedCogs, editable, say, onDirty, renderVs }: BuilderViewProps) {
  const c = useCompany();
  const router = useRouter();
  const { d, ms, tl } = useT();
  const t = d.bud;
  const b = t.b;
  const fmt = useCompact();
  const fyStart = c.settings.fyStartMonth ?? 1;
  const months = useMemo(() => fyMonths(version.fy, fyStart), [version.fy, fyStart]);
  const setup = current.setup ?? companySetup ?? emptySetup();
  const bb = useMemo(() => builderBases({ products: salesProducts, customers: salesCustomers, expenses: expenseAccounts, stockCogs, mixedCogs, asOfDate: c.asOf }, setup, version.fy, fyStart),
    [salesProducts, salesCustomers, expenseAccounts, stockCogs, mixedCogs, c.asOf, setup, version.fy, fyStart]);
  // Saved rows are the truth (their cost of sales was fixed when the version was built); live data only fills the bases.
  // Expense rows that are not costs (a balance-sheet account such as stock interim, in a version saved before they were
  // filtered out) are left out of the rows: named once below, and gone from the version on the next save.
  const [initial] = useState(() => versionRows(current.rows, bb));
  const notCosts = useMemo(() => initial.expense.filter((r) => !isBudgetedExpense(r)), [initial]);
  const [rows, setRows] = useState(() => ({ ...initial, expense: initial.expense.filter(isBudgetedExpense) }));
  // Customers typed by hand (kept as typed); the others follow the revenue by their share.
  const [edited, setEdited] = useState(() => new Set(rows.customer.filter((r) => r.basis !== null).map((r) => r.key)));
  const [dirty, setDirty] = useState(0);
  // The open tab lives in the address (?btab=), so the redraw after a save (or a reload) keeps the person where they were.
  const params = useSearchParams();
  const asTab = (v: string | null): Tab => ((TABS as readonly string[]).includes(v ?? "") ? (v as Tab) : "revenue");
  const [tab, setTabState] = useState<Tab>(() => asTab(params.get("btab")));
  function setTab(k: Tab) {
    setTabState(k);
    const u = new URL(window.location.href);
    if (k === "revenue") u.searchParams.delete("btab"); else u.searchParams.set("btab", k);
    window.history.replaceState(window.history.state, "", u);
  }
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
  const lines = useMemo(() => budgetToLines(all, months), [all, months]);
  // Until something is edited, the strip and Budget vs actual show the lines as saved (an approved version's own).
  const shown = useMemo(() => (dirty === 0 && current.rows.length && current.lines?.length ? current.lines.filter((l) => l.cls === "revenue" || INCOME.has(l.cls) || isCostLine(l.cls)) : lines),
    [dirty, current.rows.length, current.lines, lines]);
  const strip = useMemo(() => budgetTotals(shown), [shown]);
  // This year's estimate through the same lines: every row at its base months (product costs work out the same way).
  const est = useMemo(() => budgetTotals(budgetToLines([...rows.revenue, ...rows.expense].map((r) => ({ ...r, months: baseOf(bases, r).months })), months)), [rows, bases, months]);
  const margin = (v: number, rev: number) => (rev ? (v / rev) * 100 : null);
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
  // Stock cost-of-goods accounts this version leaves out: its revenue rows carry the product cost and its expense rows
  // don't hold them (as built; never re-decided from live data).
  const excluded = useMemo(() => {
    if (!rows.revenue.some((r) => r.cost?.kind === "unit" || r.cost?.kind === "margin")) return [];
    const inGroups = new Set(setup.expenses.merged.flatMap((g) => g.accounts));
    const have = new Set(rows.expense.map((r) => r.key));
    return stockCogs.filter((a) => !have.has(`exp:${a}`) && !inGroups.has(a) && !setup.expenses.excluded.includes(a));
  }, [rows, stockCogs, setup]);

  const revTotal = sumOf(revenueMonths);
  const revenueMix = ranked(rows.revenue.map((r) => ({ key: r.key, label: labelOf(r), value: sumOf(r.months) })), revTotal);
  const custItems = ranked(rows.customer.map((r) => ({ key: r.key, label: r.label, value: sumOf(r.months) })), revTotal);
  const custTotal = custItems.reduce((x, i) => x + i.value, 0);
  // The top five's share of the revenue (what the label says), not of the customers' total.
  const custMix = { items: custItems, total: custTotal, top5: revTotal ? (custItems.slice(0, 5).reduce((x, i) => x + i.value, 0) / revTotal) * 100 : 0 };
  const groupMix = ranked(groups.filter((g) => g.by === "products").map((g) => ({ key: g.id, label: g.id === "others" ? b.others : g.name, value: sumOf(g.months) })), revTotal);
  const expBy = new Map<string, number>();
  for (const r of rows.expense) { const g = GROUP_OF_CLS.get(expenseClass(r))?.key ?? "other"; expBy.set(g, (expBy.get(g) ?? 0) + sumOf(r.months)); }
  const expMix = EXPENSE_GROUPS.filter((g) => expBy.has(g.key)).map((g) => ({ key: g.key, label: tl(g.name), value: expBy.get(g.key)!, color: GROUP_COLOR[g.key] }));

  return (
    <div data-testid="budget-builder">
      {drift && <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm" data-testid="bsetup-drift">{b.drift}</p>}
      <BudgetCards fy={version.fy} note={b.stripNote} cur={c.settings.currency} figures={[
        { key: "revenue", now: strip.revenue, est: est.revenue, testId: "bsheet-strip-revenue" },
        { key: "gp", now: strip.gp, est: est.gp, margin: margin(strip.gp, strip.revenue), testId: "bsheet-strip-gp" },
        { key: "exp", now: strip.exp, est: est.exp, cost: true },
        { key: "np", now: strip.np, est: est.np, margin: margin(strip.np, strip.revenue), testId: "bsheet-strip-np" },
      ]} />
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} data-testid={`btab-${k}`}
            className={cn("-mb-px shrink-0 border-b-2 px-3 py-2 text-sm", tab === k ? "border-brand-d font-medium" : "border-transparent text-mute")}>{b.tabs[k]}</button>
        ))}
      </div>

      {tab === "revenue" && <>
        <ChartCard testId="bchart-revenue" title={b.charts.revenue} note={b.chartNote} summary={revenueMix.slice(0, 8).map((x) => `${x.label} ${fmt(x.value)} (${pct(x.share ?? 0, 1)})`).join(", ")}>
          <BarList items={revenueMix} cur={c.settings.currency} max={8} fmt={fmt} />
        </ChartCard>
        <BudgetSheet {...sheet} rows={rows.revenue} onChange={onRevenue} labelOf={labelOf} members={members} units share />
      </>}
      {tab === "customers" && <>
        <ChartCard testId="bchart-customers" title={b.charts.customers} note={b.chartNote} summary={custMix.items.slice(0, 10).map((x) => `${x.label} ${fmt(x.value)}`).join(", ")}
          extra={custMix.total > 0 && <span className="rounded bg-band px-2 py-0.5 text-xs font-medium" data-testid="bchart-top5">{b.top5(pct(custMix.top5, 1))}</span>}>
          <BarList items={custMix.items.slice(0, 10)} cur={c.settings.currency} max={10} fmt={fmt} />
        </ChartCard>
        {off && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm" data-testid="customer-diff" role="status">
            <span>{diffYear >= 0 ? b.custDiff(fmt(Math.abs(diffYear))) : b.custDiffOver(fmt(Math.abs(diffYear)))}</span>
            {editable && <button type="button" className="ms-auto rounded bg-brand-d px-3 py-1 text-white" title={b.balanceHint} onClick={balance} data-testid="customer-balance">{b.balance}</button>}
          </div>
        )}
        <BudgetSheet {...sheet} rows={rows.customer} onChange={onCustomers} share
          auto={(r) => ({ ...r, mode: "year", basis: null })} />
      </>}
      {tab === "streams" && <>
        <ChartCard testId="bchart-streams" title={b.charts.streams} summary={`${b.sales} ${fmt(sumOf(streams.sales))}, ${b.rental} ${fmt(sumOf(streams.rental))}`}>
          <ColumnChart stacked labels={months.map(ms)} cur={c.settings.currency} height={240} ariaLabel={b.charts.streams}
            series={[{ name: b.sales, values: streams.sales, color: ramp(2)[0] }, { name: b.rental, values: streams.rental, color: ramp(2)[1] }]} />
        </ChartCard>
        <ViewTable testId="bstreams" note={b.streamsNote} months={months} rows={[{ id: "sales", name: b.sales, months: streams.sales }, { id: "rental", name: b.rental, months: streams.rental }]} total={revenueMonths} />
      </>}
      {tab === "groups" && <>
        <ChartCard testId="bchart-groups" title={b.charts.groups} note={b.chartNote} summary={groupMix.map((x) => `${x.label} ${fmt(x.value)} (${pct(x.share ?? 0, 1)})`).join(", ")}>
          <BarList items={groupMix} cur={c.settings.currency} max={10} fmt={fmt} />
        </ChartCard>
        <ViewTable testId="bgroups" note={b.groupsNote} months={months} rows={groups.filter((g) => g.by === "products").map((g) => ({ ...g, name: g.id === "others" ? b.others : g.name }))} total={revenueMonths} />
        {groups.some((g) => g.by === "customers") && (
          <div className="mt-6">
            <h2 className="mb-1 font-medium">{b.custGroups}</h2>
            <ViewTable testId="bgroups-customers" note={b.custGroupsNote} months={months} rows={groups.filter((g) => g.by === "customers")} />
          </div>
        )}
      </>}
      {tab === "expenses" && editable && notCosts.length > 0 && (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm" role="status" data-testid="bexp-bs-note">{b.bsNote(notCosts.map((r) => r.label).join(", "))}</p>
      )}
      {tab === "expenses" && excluded.length > 0 && <p className="mb-2 text-xs text-mute" data-testid="bexp-cos-note">{b.cosNote(excluded.join(", "))}</p>}
      {tab === "expenses" && <>
        <ChartCard testId="bchart-expenses" title={b.charts.expenses} note={b.chartNote} summary={expMix.map((x) => `${x.label} ${fmt(x.value)}`).join(", ")}>
          <SplitBar parts={expMix} />
        </ChartCard>
        <BudgetSheet {...sheet} rows={rows.expense} cost onChange={(next) => { setRows((r) => ({ ...r, expense: next })); changed(); }} />
      </>}
      {tab === "vs" && renderVs(shown)}

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
              <tr key={r.id} data-testid={`${testId}-row`}><td className="text-start">{r.name}</td>{r.months.map((v, i) => <td key={i}><Amt v={v} /></td>)}<td className="font-medium"><Amt v={sumOf(r.months)} /></td></tr>
            ))}
            {total && <tr className="tot"><td className="text-start">{b.total}</td>{total.map((v, i) => <td key={i}><Amt v={v} /></td>)}<td><Amt v={sumOf(total)} /></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
