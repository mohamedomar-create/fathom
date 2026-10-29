"use client";
import { useState } from "react";
import { bankChargesAsInterest, compareWeight, splitRetained, bsCalc, cashFlowStatement, hasBS, type MonthData, money, pct, plCalc, sumPL, type BSCalc, type ClassKey, type PLCalc } from "@/lib/engine";
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

type View = "pl" | "bs" | "cf";
type Cmp = "prior" | "ly";

const PL_ROWS: { l: string; k: keyof PLCalc; tot?: boolean; cost?: boolean; classes?: ClassKey[]; ifAdjusted?: boolean }[] = [
  { l: "Revenue", k: "revenue", classes: ["revenue"] },
  { l: "Cost of Sales", k: "cos", cost: true, classes: ["cos_variable", "cos_fixed", "cos_depreciation"] },
  { l: "Gross Profit", k: "gross_profit", tot: true },
  { l: "Expenses", k: "expenses", cost: true, classes: ["exp_variable", "exp_fixed", "exp_depreciation"] },
  { l: "Operating Profit", k: "operating_profit", tot: true },
  { l: "Other Income", k: "other_income", classes: ["other_income"] },
  { l: "Other Expenses", k: "other_expenses", cost: true, classes: ["other_expenses"] },
  { l: "Earnings Before Interest & Tax", k: "ebit", tot: true },
  { l: "Interest Income", k: "interest_income", classes: ["interest_income"] },
  { l: "Interest Expenses", k: "interest_expenses", cost: true, classes: ["interest_expenses"] },
  { l: "Earnings Before Tax", k: "ebt", tot: true },
  { l: "Tax Expenses", k: "tax_expenses", cost: true, classes: ["tax_expenses"] },
  { l: "Earnings After Tax", k: "eat", tot: true, ifAdjusted: true },
  { l: "Adjustments (prior-period and one-off items)", k: "adjustments", cost: true, classes: ["adjustments"], ifAdjusted: true },
  { l: "Net Income", k: "net_income", tot: true },
];
type BsRow = { l: string; k?: keyof BSCalc; typ: 0 | 1 | 2 };
const BS_ROWS: BsRow[] = [
  { l: "ASSETS", typ: 2 }, { l: "Cash & Equivalents", k: "cash", typ: 0 }, { l: "Accounts Receivable", k: "ar", typ: 0 }, { l: "Inventory", k: "inventory", typ: 0 },
  { l: "Work In Progress", k: "wip", typ: 0 }, { l: "Other Current Assets", k: "other_ca", typ: 0 }, { l: "Total Current Assets", k: "tca", typ: 1 },
  { l: "Fixed Assets", k: "fixed_assets", typ: 0 }, { l: "Intangible Assets", k: "intangibles", typ: 0 }, { l: "Investments / Other NCA", k: "investments", typ: 0 },
  { l: "Total Non-Current Assets", k: "tnca", typ: 1 }, { l: "Total Assets", k: "ta", typ: 1 },
  { l: "LIABILITIES", typ: 2 }, { l: "Short Term Debt", k: "std", typ: 0 }, { l: "Accounts Payable", k: "ap", typ: 0 }, { l: "Tax Liability", k: "tax_liab", typ: 0 },
  { l: "Other Current Liabilities", k: "other_cl", typ: 0 }, { l: "Total Current Liabilities", k: "tcl", typ: 1 }, { l: "Long Term Debt", k: "ltd", typ: 0 },
  { l: "Other Non-Current Liabilities", k: "other_ncl", typ: 0 }, { l: "Total Non-Current Liabilities", k: "tncl", typ: 1 }, { l: "Total Liabilities", k: "tl", typ: 1 },
  { l: "EQUITY", typ: 2 }, { l: "Retained Earnings", k: "retained_earnings", typ: 0 }, { l: "Other Equity", k: "other_equity", typ: 0 }, { l: "Total Equity", k: "te", typ: 1 },
  { l: "Total Liabilities & Equity", k: "tle", typ: 1 },
];

export function FinancialsPage() {
  const c = useCompany();
  const bankAsInterest = bankChargesAsInterest(c.accounts);
  const a = useAnalysis();
  const comments = useComments();
  const [view, setView] = useState<View>("pl");
  const [layout, setLayout] = useState<"summary" | "detailed">("summary");
  const [cmp, setCmp] = useState<Cmp>("prior");
  const [src, setSrc] = useState<SourceLine | null>(null);
  const T = useT();
  const t = T.d.ana;
  if (!a) return null;
  const trace = (key: string, label: string, statement: "PL" | "BS", v: number) => (
    <button type="button" onClick={() => setSrc({ key, label, statement, periods: a.view.window.periods })} className="decoration-dotted underline-offset-4 hover:underline" title={t.traceTitle} data-testid={`trace-${key}`}>{m(v)}</button>
  );
  const cur = c.settings.currency;
  const m = (v: number) => money(v, cur);
  const comp = cmp === "prior" ? a.view.prior : a.view.ly;
  const compLabel = comp ? T.pl(comp.label) : cmp === "prior" ? t.prior : t.lastYear;
  const { P, B, B0 } = a.view;
  const periods = a.view.window.periods;
  const compPeriods = (() => {
    const shift = cmp === "ly" ? 12 : a.view.sel.type === "month" ? 1 : a.view.sel.type === "quarter" ? 3 : 12;
    return periods.map((p) => { const [y, mo] = p.split("-").map(Number); const i = y * 12 + mo - 1 - shift; return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`; });
  })();
  const hasDetail = c.accounts.length > 0;
  const accts = (classes: ClassKey[] | undefined, isBS: boolean) => !classes || layout !== "detailed" ? [] : c.accounts.filter((x) => classes.includes(x.cls)).map((x) => ({
    id: x.id, name: `${x.code} ${x.name}`,
    cur: isBS ? x.amounts[a.view.window.end] ?? 0 : periods.reduce((s, p) => s + (x.amounts[p] ?? 0), 0),
    // A part month: the comparison's last month counts the same days, as in the total row above.
    cmp: isBS ? x.amounts[compPeriods[compPeriods.length - 1]] ?? 0 : compPeriods.reduce((s, p, i) => s + (x.amounts[p] ?? 0) * (comp && i === compPeriods.length - 1 ? compareWeight(a.view.partDay, p) : 1), 0),
  })).filter((x) => x.cur || x.cmp);
  // Balance-sheet movements are neither good nor bad in themselves, so they are not coloured.
  const varCell = (x: number, y: number | undefined, cost: boolean | "neutral" = false) => {
    if (!y) return <td className="text-mute">–</td>;
    const v = ((x - y) / Math.abs(y)) * 100;
    if (cost === "neutral") return <td>{pct(v)}</td>;
    const good = cost ? v <= 0 : v >= 0;
    return <td className={good ? "text-green-d" : "text-red"}>{pct(v)}</td>;
  };
  const ytd = a.view.ytd;
  const fyCompMonths = c.months.filter((x) => compPeriods.includes(x.period));
  const compP = comp?.P ?? (fyCompMonths.length ? plCalc(sumPL(fyCompMonths.map((x) => x.pl))) : null);
  return (
    <>
      <PageHeader title={T.d.nav["analysis/financials"][1]} right={<PeriodPicker />}>
        <div className="sent">
          {t.view} <SentenceSelect testId="fin-view" value={view} onChange={setView} options={[{ value: "pl", label: t.pl }, { value: "bs", label: t.bs }, { value: "cf", label: t.cf }]} />
          {" "}{t.showingWord} <SentenceSelect value={layout} onChange={setLayout} options={[{ value: "summary", label: t.summary }, { value: "detailed", label: t.detailed, disabled: !hasDetail, hint: hasDetail ? t.accountLines : t.needsAccounts }]} />
          {" "}{t.financialsCompared} <SentenceSelect value={cmp} onChange={setCmp} options={[{ value: "prior", label: a.view.sel.type === "month" ? t.cmpLastMonth : t.cmpPrior }, { value: "ly", label: a.view.sel.type === "month" ? t.cmpSameMonthLY : t.cmpSamePeriodLY }]} />
        </div>
      </PageHeader>
      {view === "pl" && (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="tbl min-w-[720px]" data-testid="pl-table">
            <thead><tr><th>{t.pl}</th><th>{T.pl(a.view.window.short)}</th><th>{compLabel}</th><th>{t.variancePct}</th><th>{t.commonSize}</th><th>{t.ytd}</th></tr></thead>
            <tbody>
              {PL_ROWS.filter((r) => !r.ifAdjusted || P.adjustments || compP?.adjustments).map((r) => [
                <tr key={r.k} className={cn("row", r.tot && "tot")}>
                  <td>{T.tl(r.l)}</td><td>{trace(r.k, T.tl(r.l), "PL", P[r.k] as number)}</td><td>{compP ? m(compP[r.k] as number) : "–"}</td>{varCell(P[r.k] as number, compP?.[r.k] as number | undefined, r.cost)}
                  <td>{P.revenue ? <><MiniPie p={((P[r.k] as number) / P.revenue) * 100} /> {pct(((P[r.k] as number) / P.revenue) * 100, 0)}</> : "–"}</td>
                  <td>{m(ytd[r.k] as number)}</td>
                </tr>,
                ...accts(r.classes, false).map((x) => (
                  <tr key={x.id} className="row text-[12.5px] text-mute"><td className="ps-6">{x.name}</td><td>{m(x.cur)}</td><td>{m(x.cmp)}</td>{varCell(x.cur, x.cmp, r.cost)}<td>{P.revenue ? pct((x.cur / P.revenue) * 100, 0) : "–"}</td><td /></tr>
                )),
              ])}
            </tbody>
          </table>
          {bankAsInterest.length > 0 && <p className="mt-2 text-xs text-mute" data-testid="bank-charges-note">{t.bankChargesNote(bankAsInterest.join(", "))}</p>}
          <Notes findings={[]} comment={comments("pl")} />
        </div>
      )}
      {view === "bs" && (
        <div className="-mx-4 overflow-x-auto px-4">
          <div className="mb-2 flex items-center justify-between">
            <span />
            {!balanced(B.imbalance) && <span className="text-sm text-red" data-testid="oob">{t.outOfBalance(m(B.imbalance))}</span>}
          </div>
          <table className="tbl min-w-[720px]" data-testid="bs-table">
            <thead><tr><th>{t.bs}</th><th>{T.ml(a.view.bsAt ?? a.view.window.end)}</th><th>{comp ? T.ml(compPeriods[compPeriods.length - 1]) : compLabel}</th><th>{t.varianceCur(cur)}</th><th>{t.variancePct}</th><th>{t.commonSize}</th></tr></thead>
            <tbody>
              {BS_ROWS.map((r) => {
                if (r.typ === 2) return <tr key={r.l} className="cat"><td colSpan={6}>{T.tl(r.l)}</td></tr>;
                const k = r.k!;
                const cb = comp?.B ?? null;
                const v = B[k] as number, v0 = cb ? (cb[k] as number) : undefined;
                if (r.typ === 0 && !v && !v0) return null;
                const dv = v0 === undefined ? null : v - v0;
                const classes = r.typ === 0 ? [k as ClassKey] : undefined;
                return [
                  <tr key={r.l} className={cn("row", r.typ === 1 && "tot")}>
                    <td>{T.tl(r.l)}</td><td>{trace(k, T.tl(r.l), "BS", v)}</td><td>{v0 === undefined ? "–" : m(v0)}</td>
                    <td className={dv === null ? "text-mute" : ""}>{dv === null ? "–" : m(dv)}</td>{varCell(v, v0, "neutral")}
                    <td>{B.ta ? <><MiniPie p={(v / B.ta) * 100} /> {pct((v / B.ta) * 100, 0)}</> : "–"}</td>
                  </tr>,
                  ...(k === "retained_earnings" && v && a.view.bsAt === a.view.window.end ? (() => {
                    const sp = splitRetained(v, a.view.ytd.retained_income);
                    return [[t.rePrior, sp.prior], [t.reCurrent, sp.current]].map(([l, x]) => (
                      <tr key={l as string} className="row text-[12.5px] text-mute" data-testid="re-split"><td className="ps-6">{l}</td><td>{m(x as number)}</td><td /><td /><td /><td /><td /></tr>
                    ));
                  })() : []),
                  ...accts(classes, true).map((x) => (
                    <tr key={x.id} className="row text-[12.5px] text-mute"><td className="ps-6">{x.name}</td><td>{m(x.cur)}</td><td>{m(x.cmp)}</td><td>{m(x.cur - x.cmp)}</td>{varCell(x.cur, x.cmp, "neutral")}<td>{B.ta ? pct((x.cur / B.ta) * 100, 0) : "–"}</td></tr>
                  )),
                ];
              })}
            </tbody>
          </table>
          <Notes findings={a.findings.filter((f) => f.section === "bs")} comment={comments("bs")} />
        </div>
      )}
      <SourceDrawer line={src} onClose={() => setSrc(null)} />
      {view === "cf" && (!a.CF || !B0 ? <MissingData view={a.view} basePath={c.basePath} need="cash" /> : <CashFlowTable P={P} B={B} B0={B0} comp={comp && compB0(c.months, compPeriods[0]) ? { P: comp.P, B: comp.B, B0: compB0(c.months, compPeriods[0])! } : null} compLabel={compLabel} cur={cur} label={T.pl(a.view.window.short)} />)}
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

function CashFlowTable({ P, B, B0, comp, compLabel, cur, label }: { P: PLCalc; B: BSCalc; B0: BSCalc; comp: { P: PLCalc; B: BSCalc; B0: BSCalc } | null; compLabel: string; cur: string; label: string }) {
  // Both columns list the same lines (an unexplained difference in either shows in both), so rows line up.
  const gap = Math.abs(cashFlowStatement(P, B, B0).unreconciled) > 0 || (comp ? Math.abs(cashFlowStatement(comp.P, comp.B, comp.B0).unreconciled) > 0 : false);
  const s = cashFlowStatement(P, B, B0, { showUnreconciled: gap });
  const s2 = comp ? cashFlowStatement(comp.P, comp.B, comp.B0, { showUnreconciled: gap }) : null;
  const T = useT();
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="tbl min-w-[560px]" data-testid="cf-table">
        <thead><tr><th>{T.d.ana.cf}</th><th>{label}</th><th>{compLabel}</th></tr></thead>
        <tbody>
          {s.lines.map((l, i) => l.heading
            ? <tr key={l.label} className="cat"><td colSpan={3}>{T.tl(l.label)}</td></tr>
            : <tr key={l.label + i} className={cn("row", l.total && "tot")}><td>{T.tl(l.label)}</td><td>{money(l.value, cur)}</td><td>{s2 ? money(s2.lines[i].value, cur) : "–"}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
