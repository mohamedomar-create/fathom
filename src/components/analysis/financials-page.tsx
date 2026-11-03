"use client";
import { useMemo, useState } from "react";
import { alignSubs, bankChargesAsInterest, compareWeight, type CFSub, splitRetained, bsCalc, cashFlowStatement, hasBS, type MonthData, money, pct, plCalc, sumPL, type BSCalc, type ClassKey, type PLCalc } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useComments, useAnalysis } from "@/lib/company/use-period";
import { PageHeader } from "@/components/shell/page-header";
import { PeriodPicker } from "@/components/shell/period-picker";
import { SentenceSelect } from "@/components/ui/sentence-select";
import { MiniPie } from "@/components/charts/spark";
import { cn } from "@/lib/cn";
import { MissingData, Notes } from "./common";
import { SourceDrawer, type SourceLine } from "./source-drawer";
import { useT } from "@/lib/i18n/use-t";
import { balanced } from "@/lib/tolerance";
import { accountMarkKey, BS_LINES, emptyBS, markAt, PL_LINES, type Highlights, type Mark } from "@/lib/engine/statement-rows";
import { cfRowCls, ChangeCell, Flag, flagReason, fmtIn, MarkButton, rowCls } from "./statement-ui";
import { setStatementMark } from "@/app/company/[id]/analysis/highlight-actions";
import { budgetAccounts, budgetComparison, budgetFor, type BudgetLine, type BudgetProduct } from "@/lib/engine/budget";
import { demoCompareBudget } from "@/lib/company/demo-budget";

/** A financial year's budget for the "Budget" comparison: its latest approved version, else its latest draft. */
export interface CompareBudget { fy: string; name: string; status: "draft" | "approved"; lines: BudgetLine[]; products: BudgetProduct[] }

type View = "pl" | "bs" | "cf";
type Cmp = "prior" | "ly" | "budget";

const PL_ROWS = PL_LINES;
const BS_ROWS = BS_LINES;

export function FinancialsPage({ budgets: budgetsIn }: { budgets?: CompareBudget[] } = {}) {
  const c = useCompany();
  // The demo shows its made-up budget; a company the budget it saved.
  const budgets = useMemo<CompareBudget[]>(() => {
    if (budgetsIn !== undefined) return budgetsIn;
    if (c.source !== "demo") return [];
    return [demoCompareBudget(c.months, c.settings.fyStartMonth ?? 1)];
  }, [budgetsIn, c.source, c.months, c.settings.fyStartMonth]);
  // The budget of the financial year the selected period falls in (none: the Budget comparison is not offered).
  const a = useAnalysis();
  const selEnd = a?.view.sel.end;
  const budget = selEnd ? budgetFor(budgets, selEnd, c.settings.fyStartMonth ?? 1) : null;
  const bAcc = useMemo(() => (budget ? budgetAccounts(budget.lines, budget.products).accounts : null), [budget]);
  const bankAsInterest = bankChargesAsInterest(c.accounts);
  const comments = useComments();
  const [view, setView] = useState<View>("pl");
  const [layout, setLayout] = useState<"summary" | "detailed">("summary");
  const [cmp, setCmp] = useState<Cmp>("ly");
  const [flagsOnly, setFlagsOnly] = useState(false);
  const [marks, setMarks] = useState<Record<string, Mark>>(c.settings.highlights?.lines ?? {});
  const [src, setSrc] = useState<SourceLine | null>(null);
  const T = useT();
  const t = T.d.ana;
  if (!a) return null;
  const cur = c.settings.currency;
  const m = (v: number) => money(v, cur);
  const trace = (key: string, label: string, statement: "PL" | "BS", v: number) => (
    <button type="button" onClick={() => setSrc({ key, label, statement, periods: a.view.window.periods })} className="decoration-dotted underline-offset-4 hover:underline" title={t.traceTitle} data-testid={`trace-${key}`}>{m(v)}</button>
  );
    // Same period last year by default; when last year isn't loaded, the previous period, and the page says so.
  const lyMissing = cmp === "ly" && !a.view.ly;
  const isBudget = cmp === "budget" && !!bAcc;
  const useCmp: "prior" | "ly" = cmp === "ly" && !lyMissing ? "ly" : "prior";
  // The budget for the same window (a part month counts the same share of its month), through the same statements.
  const budgetComp = isBudget ? { ...budgetComparison(bAcc!, a.view.sel, c.settings.fyStartMonth ?? 1, budget!.name, a.view.partDay), sub: undefined } : null;
  const comp = isBudget ? budgetComp : useCmp === "prior" ? a.view.prior : a.view.ly;
  const compLabel = isBudget ? `${T.d.hl.budget} · ${budget!.name}` : comp ? T.pl(comp.label) : useCmp === "prior" ? t.prior : t.lastYear;
  const bByKey = new Map((bAcc ?? []).map((x) => [x.id, x]));
  const h = c.settings.highlights;
  const fmt = fmtIn(cur);
  const canMark = !c.readOnly && c.source !== "demo";
  const saveMark = async (key: string, mk: Mark | null) => {
    const r = await setStatementMark(c.id, key, mk);
    if (r.ok) setMarks((x) => { const n = { ...x }; if (mk) n[key] = mk; else delete n[key]; return n; });
    return r;
  };
  const markOf = (key: string) => markAt(marks, key);
  // flagKey: the line (or an account's class) the rules read; key: where the mark is kept.
  const nameCell = (statement: "PL" | "BS", key: string, label: string, cur0: number, cmp0: number | null | undefined, indent = false, flagKey = key) => {
    const why = flagReason(statement, flagKey, cur0, cmp0, h, fmt, T);
    return { why, td: <td className={indent ? "ps-6" : undefined}>{label}<Flag reason={why} /><MarkButton markKey={key} mark={markOf(key)} canEdit={canMark} onSave={saveMark} label={label} /></td> };
  };
  const { P, B, B0 } = a.view;
  const periods = a.view.window.periods;
  const compPeriods = (() => {
    const shift = isBudget ? 0 : useCmp === "ly" ? 12 : a.view.sel.type === "month" ? 1 : a.view.sel.type === "quarter" ? 3 : 12;
    return periods.map((p) => { const [y, mo] = p.split("-").map(Number); const i = y * 12 + mo - 1 - shift; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; });
  })();
  const hasDetail = c.accounts.length > 0;
  const accts = (classes: ClassKey[] | undefined, isBS: boolean) => !classes || layout !== "detailed" ? [] : c.accounts.filter((x) => classes.includes(x.cls)).map((x) => ({
    id: x.id, key: accountMarkKey(x), name: `${x.code} ${x.name}`,
    cur: isBS ? x.amounts[a.view.window.end] ?? 0 : periods.reduce((s, p) => s + (x.amounts[p] ?? 0), 0),
    // A part month: the comparison's last month counts the same days, as in the total row above.
    cmp: isBudget
      ? (isBS ? 0 : compPeriods.reduce((s, p, i) => s + (bByKey.get(accountMarkKey(x))?.amounts[p] ?? 0) * (i === compPeriods.length - 1 ? compareWeight(a.view.partDay, p) : 1), 0))
      : isBS ? x.amounts[compPeriods[compPeriods.length - 1]] ?? 0 : compPeriods.reduce((s, p, i) => s + (x.amounts[p] ?? 0) * (comp && i === compPeriods.length - 1 ? compareWeight(a.view.partDay, p) : 1), 0),
  })).filter((x) => x.cur || x.cmp);
  // A comparison month with no balance sheet loaded is no comparison (not a balance sheet of zeros).
  const cbOk = !!comp && !emptyBS(comp.B);
  const ytd = a.view.ytd;
  // Whether any line (or account under it) of a statement needs a look, for "only lines that need a look".
  const anyFlag = (st: "PL" | "BS") => st === "PL"
    ? PL_ROWS.some((r) => flagReason("PL", r.k, P[r.k] as number, compP?.[r.k] as number | undefined, h, fmt, T) || accts(r.classes, false).some((x) => flagReason("PL", r.k, x.cur, x.cmp, h, fmt, T)))
    : BS_ROWS.some((r) => r.k && (flagReason("BS", r.k, B[r.k] as number, cbOk ? (comp!.B[r.k] as number) : undefined, h, fmt, T) || (r.typ === 0 && accts([r.k as ClassKey], true).some((x) => flagReason("BS", r.k!, x.cur, cbOk ? x.cmp : undefined, h, fmt, T)))));
  const fyCompMonths = c.months.filter((x) => compPeriods.includes(x.period));
  const compP = comp?.P ?? (fyCompMonths.length === compPeriods.length ? plCalc(sumPL(fyCompMonths.map((x) => x.pl))) : null);
  return (
    <>
      <PageHeader title={T.d.nav["analysis/financials"][1]} right={<PeriodPicker />}>
        <div className="sent">
          {t.view} <SentenceSelect testId="fin-view" value={view} onChange={setView} options={[{ value: "pl", label: t.pl }, { value: "bs", label: t.bs }, { value: "cf", label: t.cf }]} />
          {" "}{t.showingWord} <SentenceSelect value={layout} onChange={setLayout} options={[{ value: "summary", label: t.summary }, { value: "detailed", label: t.detailed, disabled: !hasDetail, hint: hasDetail ? t.accountLines : t.needsAccounts }]} />
          {" "}{t.financialsCompared} <SentenceSelect testId="fin-compare" value={cmp} onChange={setCmp} options={[{ value: "ly", label: a.view.sel.type === "month" ? t.cmpSameMonthLY : t.cmpSamePeriodLY }, { value: "prior", label: a.view.sel.type === "month" ? t.cmpLastMonth : t.cmpPrior }, { value: "budget", label: T.d.hl.budget, disabled: !bAcc, hint: bAcc ? undefined : T.d.hl.budgetSoon }]} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
          {lyMissing && <span data-testid="ly-missing">{T.d.hl.lyMissing}</span>}
          <span>{T.d.hl.legend}</span>
          <label className="inline-flex min-h-6 items-center gap-1.5"><input type="checkbox" className="h-6 w-6" checked={flagsOnly} onChange={(e) => setFlagsOnly(e.target.checked)} data-testid="flags-only" /> {T.d.hl.flagsOnly}</label>
        </div>
      </PageHeader>
      {view === "pl" && (
        <div tabIndex={0} className="-mx-4 overflow-x-auto px-4">
          <table className="tbl min-w-[720px]" data-testid="pl-table">
            <thead><tr><th>{t.pl}</th><th>{T.pl(a.view.window.short)}</th><th>{compLabel}</th><th>{t.variancePct}</th><th>{t.commonSize}</th><th>{t.ytd}</th></tr></thead>
            <tbody>
              {PL_ROWS.filter((r) => !r.ifAdjusted || P.adjustments || compP?.adjustments).map((r) => {
                const v = P[r.k] as number, v0 = compP ? (compP[r.k] as number) : undefined;
                const nc = nameCell("PL", r.k, T.tl(r.l), v, v0);
                const lines = accts(r.classes, false).map((x) => ({ x, nc: nameCell("PL", x.key, x.name, x.cur, x.cmp, true, r.k) })).filter((y) => !flagsOnly || y.nc.why);
                if (flagsOnly && !nc.why && !lines.length) return null;
                return [
                  <tr key={r.k} className={rowCls(r.k, { mark: markOf(r.k), flagged: !!nc.why })} data-line={r.k}>
                    {nc.td}<td>{trace(r.k, T.tl(r.l), "PL", v)}</td><td>{compP ? m(v0!) : "–"}</td><ChangeCell statement="PL" k={r.k} cur={v} cmp={v0} kind="pct" fmt={fmt} />
                    <td>{P.revenue ? <><MiniPie p={(v / P.revenue) * 100} /> {pct((v / P.revenue) * 100, 0)}</> : "–"}</td>
                    <td>{m(ytd[r.k] as number)}</td>
                  </tr>,
                  ...lines.map(({ x, nc: a1 }) => (
                    <tr key={x.id} className={cn("row text-[12.5px] text-mute", markOf(x.key) && `mk-${markOf(x.key)!.color}`, a1.why && "flagged")} data-line={x.key}>{a1.td}<td>{m(x.cur)}</td><td>{m(x.cmp)}</td><ChangeCell statement="PL" k={r.k} cur={x.cur} cmp={x.cmp} kind="pct" fmt={fmt} /><td>{P.revenue ? pct((x.cur / P.revenue) * 100, 0) : "–"}</td><td /></tr>
                  )),
                ];
              })}
            </tbody>
          </table>
          {flagsOnly && !anyFlag("PL") && <p className="mt-2 text-sm text-mute" data-testid="no-flags">{T.d.hl.noFlags}</p>}
          {bankAsInterest.length > 0 && <p className="mt-2 text-xs text-mute" data-testid="bank-charges-note">{t.bankChargesNote(bankAsInterest.join(", "))}</p>}
          <Notes findings={[]} comment={comments("pl")} />
        </div>
      )}
      {view === "bs" && (
        <div tabIndex={0} className="-mx-4 overflow-x-auto px-4">
          <div className="mb-2 flex items-center justify-between">
            <span />
            {!balanced(B.imbalance) && <span className="text-sm text-red" data-testid="oob">{t.outOfBalance(m(B.imbalance))}</span>}
          </div>
          <table className="tbl min-w-[720px]" data-testid="bs-table">
            <thead><tr><th>{t.bs}</th><th>{T.ml(a.view.bsAt ?? a.view.window.end)}</th><th>{comp && !isBudget ? T.ml(compPeriods[compPeriods.length - 1]) : compLabel}</th><th>{t.varianceCur(cur)}</th><th>{t.variancePct}</th><th>{t.commonSize}</th></tr></thead>
            <tbody>
              {BS_ROWS.map((r) => {
                if (r.typ === 2) return flagsOnly ? null : <tr key={r.l} className="cat"><td colSpan={6}>{T.tl(r.l)}</td></tr>;
                const k = r.k!;
                const cb = cbOk ? comp!.B : null;
                const v = B[k] as number, v0 = cb ? (cb[k] as number) : undefined;
                if (r.typ === 0 && !v && !v0) return null;
                const classes = r.typ === 0 ? [k as ClassKey] : undefined;
                const nc = nameCell("BS", k, T.tl(r.l), v, v0);
                const lines = accts(classes, true).map((x) => ({ x, nc: nameCell("BS", x.key, x.name, x.cur, cbOk ? x.cmp : undefined, true, k) })).filter((y) => !flagsOnly || y.nc.why);
                if (flagsOnly && !nc.why && !lines.length) return null;
                return [
                  <tr key={r.l} className={rowCls(k, { mark: markOf(k), flagged: !!nc.why })} data-line={k}>
                    {nc.td}<td>{trace(k, T.tl(r.l), "BS", v)}</td><td>{v0 === undefined ? "–" : m(v0)}</td>
                    <ChangeCell statement="BS" k={k} cur={v} cmp={v0} kind="money" fmt={fmt} /><ChangeCell statement="BS" k={k} cur={v} cmp={v0} kind="pct" fmt={fmt} />
                    <td>{B.ta ? <><MiniPie p={(v / B.ta) * 100} /> {pct((v / B.ta) * 100, 0)}</> : "–"}</td>
                  </tr>,
                  ...(k === "retained_earnings" && v && a.view.bsAt === a.view.window.end ? (() => {
                    const sp = splitRetained(v, a.view.ytd.retained_income);
                    return [[t.rePrior, sp.prior], [t.reCurrent, sp.current]].map(([l, x]) => (
                      <tr key={l as string} className="row text-[12.5px] text-mute" data-testid="re-split"><td className="ps-6">{l}</td><td>{m(x as number)}</td><td /><td /><td /><td /><td /></tr>
                    ));
                  })() : []),
                  ...lines.map(({ x, nc: a1 }) => (
                    <tr key={x.id} className={cn("row text-[12.5px] text-mute", markOf(x.key) && `mk-${markOf(x.key)!.color}`, a1.why && "flagged")} data-line={x.key}>{a1.td}<td>{m(x.cur)}</td><td>{cbOk ? m(x.cmp) : "–"}</td><ChangeCell statement="BS" k={k} cur={x.cur} cmp={cbOk ? x.cmp : undefined} kind="money" fmt={fmt} /><ChangeCell statement="BS" k={k} cur={x.cur} cmp={cbOk ? x.cmp : undefined} kind="pct" fmt={fmt} /><td>{B.ta ? pct((x.cur / B.ta) * 100, 0) : "–"}</td></tr>
                  )),
                ];
              })}
            </tbody>
          </table>
          {flagsOnly && !anyFlag("BS") && <p className="mt-2 text-sm text-mute" data-testid="no-flags">{T.d.hl.noFlags}</p>}
          <Notes findings={a.findings.filter((f) => f.section === "bs")} comment={comments("bs")} />
        </div>
      )}
      <SourceDrawer line={src} onClose={() => setSrc(null)} />
      {view === "cf" && (!a.CF || !B0 ? <MissingData view={a.view} basePath={c.basePath} need="cash" /> : <CashFlowTable P={P} B={B} B0={B0} sub={a.view.sub} comp={!isBudget && comp && compB0(c.months, compPeriods[0]) ? { P: comp.P, B: comp.B, B0: compB0(c.months, compPeriods[0])!, sub: comp.sub } : null} compLabel={compLabel} cur={cur} label={T.pl(a.view.window.short)} h={h} flagsOnly={flagsOnly} />)}
    </>
  );
}

function compB0(months: MonthData[], start: string) {
  const [y, mo] = start.split("-").map(Number);
  const i = y * 12 + mo - 2;
  const p = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  const m = months.find((x) => x.period === p);
  return m && hasBS(m) ? bsCalc(m.bs) : null;
}

function CashFlowTable({ P, B, B0, sub, comp, compLabel, cur, label, h, flagsOnly }: { P: PLCalc; B: BSCalc; B0: BSCalc; sub?: CFSub; comp: { P: PLCalc; B: BSCalc; B0: BSCalc; sub?: CFSub } | null; compLabel: string; cur: string; label: string; h?: Highlights; flagsOnly: boolean }) {
  // Both columns list the same lines (an unexplained difference in either shows in both), so rows line up.
  const [s1, c1] = alignSubs(sub, comp?.sub);
  const gap = Math.abs(cashFlowStatement(P, B, B0, { sub: s1 }).unreconciled) > 0 || (comp ? Math.abs(cashFlowStatement(comp.P, comp.B, comp.B0, { sub: c1 }).unreconciled) > 0 : false);
  const s = cashFlowStatement(P, B, B0, { showUnreconciled: gap, sub: s1 });
  const s2 = comp ? cashFlowStatement(comp.P, comp.B, comp.B0, { showUnreconciled: gap, sub: c1 }) : null;
  const T = useT();
  return (
    <div tabIndex={0} className="-mx-4 overflow-x-auto px-4">
      <table className="tbl min-w-[560px]" data-testid="cf-table">
        <thead><tr><th>{T.d.ana.cf}</th><th>{label}</th><th>{compLabel}</th><th>{T.d.ana.varianceCur(cur)}</th></tr></thead>
        <tbody>
          {s.lines.map((l, i) => {
            if (l.heading) return flagsOnly ? null : <tr key={l.label} className="cat"><td colSpan={4}>{T.tl(l.label)}</td></tr>;
            const v0 = s2 ? s2.lines[i].value : undefined;
            const why = flagReason("CF", l.label, l.value, v0, h, (v) => money(v, cur), T);
            if (flagsOnly && !why) return null;
            return <tr key={l.label + i} className={cn(cfRowCls(l.label, l.total), why && "flagged")}><td>{T.tl(l.label)}<Flag reason={why} /></td><td>{money(l.value, cur)}</td><td>{v0 === undefined ? "–" : money(v0, cur)}</td><ChangeCell statement="CF" k={l.label} cur={l.value} cmp={v0} kind="money" fmt={(v) => money(v, cur)} /></tr>;
          })}
        </tbody>
      </table>
      {s.estimated.length > 0 && (
        <div className="mt-2 text-xs text-mute" data-testid="cf-estimated">
          <p>{T.d.ana.cfEstimated}</p>
          <ul className="ms-4 list-disc">{s.estimated.map((e) => <li key={e}>{T.tl(e)}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

