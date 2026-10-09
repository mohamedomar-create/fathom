"use client";
import { Fragment, useMemo } from "react";
import {
  analyze, bsCalc, CAT_COL, CAT_ORDER, formatTrend, goalseekTable, GOAL_KPIS, LEVERS, mlabel, money, mshort, num, pct, plCalc, quadrantOf, QUADRANT_TEXT,
  type Analysis, type Finding, type PLCalc, type BSCalc,
} from "@/lib/engine";
import { BreakevenChart } from "@/components/charts/breakeven-chart";
import { CashWaterfall } from "@/components/charts/waterfall";
import { GrowthQuadrant } from "@/components/charts/growth-quadrant";
import { KpiArc } from "@/components/charts/kpi-arc";
import { LineChart } from "@/components/charts/line-chart";
import { MiniPie, Sparkline } from "@/components/charts/spark";
import { StaticCharts } from "@/components/charts/static";
import { StatusIcon } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { runChecks, type CheckId } from "@/lib/company/checks";
import { SECTION_COMMENT, type ReportInput, type SectionKey } from "@/lib/report/types";

const AUTO_SECTIONS: Partial<Record<SectionKey, Finding["section"][]>> = { kpis: ["kpis"], profitability: ["profitability"], cashflow: ["cashflow"], trend: ["trend"], bs: ["bs"] };

/** A4-styled, print-ready management report. Used for the editor preview, the public link and PDF export. */
export function ReportDocument({ input }: { input: ReportInput }) {
  const a = useMemo(() => analyze(input.months, input.sel, input.settings, { alerts: input.alerts }), [input.months, input.sel, input.settings, input.alerts]);
  const cur = input.settings.currency;
  const brand = input.org.brandColour ?? "#4F8A41";
  const enabled = input.sections.filter((s) => s.enabled).map((s) => s.key);
  const comment = (k: SectionKey) => {
    const key = SECTION_COMMENT[k];
    const typed = key ? input.commentary[key] : undefined;
    if (typed) return <div className="rcomment whitespace-pre-line">{typed}</div>;
    const fs = a.findings.filter((f) => AUTO_SECTIONS[k]?.includes(f.section)).slice(0, 3);
    if (!fs.length) return null;
    return <div className="rcomment"><div className="label mb-1">Analyst notes</div>{fs.map((f) => <div key={f.title} className="py-0.5"><b className="font-semibold">{f.title}.</b> {f.text}</div>)}</div>;
  };
  const head = (title: string, upto = false) => (
    <div className="rhead" style={{ borderColor: brand }}>
      <h2>{title}</h2>
      <div className="text-[12px] text-mute">{upto ? "Up to the " : "For the "}<b className="text-ink">{a.view.window.label}</b></div>
    </div>
  );
  const sections: Record<SectionKey, () => React.ReactNode> = {
    cover: () => <Cover input={input} a={a} brand={brand} />,
    summary: () => <>{head("Executive Summary")}<Summary input={input} a={a} cur={cur} />{null}</>,
    kpis: () => <>{head("KPIs")}<KpiTable a={a} cur={cur} />{comment("kpis")}</>,
    explorer: () => {
      const items = a.kpiRows.filter((r) => r.ok !== null).sort((x, y) => CAT_ORDER.indexOf(x.def.category) - CAT_ORDER.indexOf(y.def.category))
        .map((r) => ({ key: r.def.key, category: r.def.category, name: r.def.name, ok: r.ok!, detail: "" }));
      const p = a.onTrack + a.offTrack ? (a.onTrack / (a.onTrack + a.offTrack)) * 100 : 0;
      return <>{head("KPI Explorer")}<KpiArc items={items} pctOn={p} period={a.view.window.short} /><p className="text-center text-[11px] text-mute">{a.kpiRows.length} KPIs · {a.onTrack} on track · {a.offTrack} off track</p></>;
    },
    profitability: () => <>{head("Profitability")}<Profitability a={a} cur={cur} />{comment("profitability")}</>,
    cashflow: () => <>{head("Cash Flow")}{a.W ? <>
      <Tiles items={[["Operating cash flow", a.W.ocf], ["Free cash flow", a.W.fcf], ["Net cash flow", a.W.ncf]]} cur={cur} />
      <CashWaterfall rows={a.W.rows} cur={cur} />
      <p className="mt-2 text-[10px] text-mute"><b>NET CASH FLOW CAN ALSO BE CALCULATED AS:</b> Change in Cash on Hand {money(a.W.dcash, cur)} − Change in Debt {money(a.W.ddebt, cur)}</p>
    </> : <p className="text-mute">Needs an opening balance sheet (the month before this period).</p>}{comment("cashflow")}</>,
    pl: () => <>{head("Profit & Loss")}<PLTable a={a} cur={cur} />{comment("pl")}</>,
    bs: () => <>{head("Balance Sheet")}<BSTable a={a} cur={cur} />{comment("bs")}</>,
    cf: () => <>{head("Cash Flow Statement")}{a.CF ? <table className="tbl text-[11.5px]"><tbody>
      {a.CF.lines.map((l, i) => l.heading ? <tr key={i} className="cat"><td colSpan={2}>{l.label}</td></tr> : <tr key={i} className={cn(l.total && "tot")}><td>{l.label}</td><td>{money(l.value, cur)}</td></tr>)}
    </tbody></table> : <p className="text-mute">Needs an opening balance sheet.</p>}</>,
    trend: () => <>{head("Trend", true)}<Trend a={a} cur={cur} />{comment("trend")}</>,
    growth: () => <>{head("Growth", true)}<Growth input={input} a={a} cur={cur} />{comment("growth")}</>,
    goalseek: () => <>{head("Goalseek")}<Goalseek a={a} />{comment("goalseek")}</>,
    basis: () => <>{head("Basis of Preparation")}<Basis input={input} a={a} cur={cur} /></>,
  };
  return (
    <StaticCharts.Provider value>
      <div id="report" className="report" style={{ ["--brand" as string]: brand }}>
        {enabled.map((k) => <section key={k} className={cn("rpage", k === "cover" && "rcover")} data-section={k}>{sections[k]()}</section>)}
      </div>
    </StaticCharts.Provider>
  );
}

function Cover({ input, a, brand }: { input: ReportInput; a: Analysis; brand: string }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="h-2 w-full rounded" style={{ background: brand }} />
      <div className="py-24 text-center">
        {input.org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo is inlined as a data URL for PDF export
          <img src={input.org.logoUrl} alt="" className="mx-auto mb-8 h-14 object-contain" />
        ) : <div className="mb-8 text-sm font-semibold uppercase tracking-[0.2em] text-mute">{input.org.name}</div>}
        <h1 className="text-[40px] font-light leading-tight">{input.title}</h1>
        <div className="mt-3 text-lg">{input.companyName}</div>
        <div className="mt-1 text-mute">{a.view.window.label}</div>
      </div>
      <div className="text-center text-[11px] text-mute">Prepared {input.preparedOn} · {input.org.name}</div>
    </div>
  );
}

function Tiles({ items, cur }: { items: [string, number][]; cur: string }) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-4">
      {items.map(([l, v]) => <div key={l} className="border-t-2 border-line pt-1.5"><div className="label">{l}</div><div className={cn("num inline-block text-[22px]", v < 0 && "bg-red-bg px-1.5 text-red")}>{money(v, cur)}</div></div>)}
    </div>
  );
}

function Summary({ input, a, cur }: { input: ReportInput; a: Analysis; cur: string }) {
  const { P, B, B0, prior, series } = a.view;
  const score = a.onTrack + a.offTrack ? (a.onTrack / (a.onTrack + a.offTrack)) * 100 : 0;
  const ch = (x: number, y?: number | null) => (y ? ((x - y) / Math.abs(y)) * 100 : null);
  const d = (v: number | null, cost = false) => v === null ? <span className="text-mute">–</span> : <span className={(cost ? v <= 0 : v >= 0) ? "text-green-d" : "text-red"}>{v > 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%</span>;
  const s12P = series.P.slice(-12), s12B = series.B.slice(-12);
  const hero: [string, string, React.ReactNode, (number | null)[], boolean][] = [
    ["Revenue", money(P.revenue, cur), <>{d(ch(P.revenue, prior?.P.revenue))} <span className="text-mute">vs {prior?.label ?? "prior"}</span></>, s12P.map((p) => p.revenue), P.revenue < 0],
    ["Gross margin", pct(a.K.gpm, 1), <span key="t" className="text-mute">target {pct(a.targets.gpm ?? 35, 0)}</span>, s12P.map((p) => (p.revenue ? (p.gross_profit / p.revenue) * 100 : null)), (a.K.gpm ?? 0) < (a.targets.gpm ?? 35)],
    ["EBIT", money(P.ebit, cur), <>{d(ch(P.ebit, prior?.P.ebit))} <span className="text-mute">vs {prior?.label ?? "prior"}</span></>, s12P.map((p) => p.ebit), P.ebit < 0],
    ["Cash on hand", money(B.cash, cur), B0 ? <>{d(ch(B.cash, B0.cash))} <span className="text-mute">vs opening</span></> : null, s12B.map((b) => b.cash), B.cash < 0],
  ];
  const headline = input.commentary.summary ||
    `${input.companyName} ${P.ebit >= 0 ? "made" : "lost"} ${money(Math.abs(P.ebit), cur)} at EBIT on revenue of ${money(P.revenue, cur)} in ${a.view.window.label}; ${a.onTrack} of ${a.onTrack + a.offTrack} measurable KPIs are on target and cash stands at ${money(B.cash, cur)}.`;
  const finds = (kind: Finding["kind"]) => {
    const l = a.findings.filter((f) => f.kind === kind).slice(0, 4);
    return l.length ? l.map((f) => (
      <div key={f.title} className="grid grid-cols-[12px_1fr] gap-2 border-b border-line py-1.5 text-[12px]">
        <span className={cn("mt-1 h-2 w-2 rounded-full", kind === "risk" ? "bg-red" : kind === "watch" ? "bg-amber" : "bg-green")} />
        <div><b className="font-semibold">{f.title}</b><div className="text-mute">{f.text}</div></div>
      </div>
    )) : <div className="py-1.5 text-[12px] text-mute">Nothing to flag.</div>;
  };
  return (
    <>
      <div className="mb-4 flex items-center gap-5 bg-band px-4 py-3">
        <div className={cn("text-[42px] font-light leading-none", score >= 60 ? "text-green-d" : "text-red")}>{Math.round(score)}%</div>
        <div><b className="font-semibold">KPIs on track</b><div className="text-[12px] text-mute">{a.onTrack} on track · {a.offTrack} off track</div></div>
      </div>
      <p className="mb-5 whitespace-pre-line text-[14.5px] leading-relaxed">{headline}</p>
      <div className="mb-5 grid grid-cols-4 gap-4">
        {hero.map(([l, v, dd, sp, neg]) => (
          <div key={l} className={cn("border-t-[3px] pt-1.5", neg ? "border-red" : "border-green")}>
            <div className="label">{l}</div><div className="num whitespace-nowrap text-[17px]">{v}</div><div className="text-[11px]">{dd}</div>
            <Sparkline values={sp} w={120} h={28} color={neg ? "#D9343A" : "#7CB46B"} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div><h3 className="mb-1 text-base font-normal">Needs attention</h3>{finds("risk")}<h3 className="mb-1 mt-4 text-base font-normal">Watch</h3>{finds("watch")}</div>
        <div><h3 className="mb-1 text-base font-normal">Going well</h3>{finds("win")}</div>
      </div>
    </>
  );
}

function KpiTable({ a, cur }: { a: Analysis; cur: string }) {
  return (
    <table className="tbl text-[11.5px]">
      <thead><tr><th>KPI</th><th>Result</th><th>Target</th><th></th><th>vs target</th><th>Importance</th></tr></thead>
      <tbody>
        {CAT_ORDER.map((cat) => {
          const rows = a.kpiRows.filter((r) => r.def.category === cat);
          if (!rows.length) return null;
          return (
            <Fragment key={cat}>
              <tr className="cat"><td colSpan={6}><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CAT_COL[cat] }} />{cat}</td></tr>
              {rows.map((r) => (
                <tr key={r.def.key}>
                  <td>{r.alert && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red align-middle" />}{r.def.name}{r.def.direction === "down" ? "*" : ""}</td>
                  <td>{num(r.value, r.def.unit, cur)}</td><td className="text-mute">{num(r.compare, r.def.unit, cur)}</td>
                  <td className="text-center"><StatusIcon ok={r.ok} /></td>
                  <td>{r.trend ? <span className={r.ok ? "text-green-d" : "text-red"}>{r.trend.value > 0 ? "▲" : "▼"} {formatTrend(r.trend, cur)}</span> : "–"}</td>
                  <td>{r.importance}</td>
                </tr>
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function Profitability({ a, cur }: { a: Analysis; cur: string }) {
  const { P } = a.view;
  const b = a.breakeven;
  return (
    <>
      <Tiles items={[["Gross profit", P.gross_profit], ["Operating profit", P.operating_profit], ["EBIT", P.ebit]]} cur={cur} />
      {b.ok ? (
        <div className="grid grid-cols-[1.35fr_1fr] items-start gap-5">
          <BreakevenChart revenue={b.revenue} fixed={b.fixedCosts} vcr={b.vcr} bep={b.bep} cur={cur} />
          <div className="space-y-3 text-[13px]">
            {[["Revenue", money(b.revenue, cur)], ["Total costs", money(b.totalCosts, cur)], ["Breakeven point", money(b.bep, cur)], ["Margin of safety", `${money(b.mos, cur)} (${b.mosPct.toFixed(0)}%)`], ["Variable costs", `${cur} ${b.vcr.toFixed(2)} per ${cur} 1 of revenue`], ["Fixed costs", money(b.fixedCosts, cur)]].map(([l, v]) => (
              <div key={l}><div className="label">{l}</div><div className="num text-[17px]">{v}</div></div>
            ))}
          </div>
        </div>
      ) : <p className="text-mute">A breakeven point cannot be calculated for this period.</p>}
    </>
  );
}

function PLTable({ a, cur }: { a: Analysis; cur: string }) {
  const { P, prior, ytd } = a.view;
  const rows: [string, keyof PLCalc, boolean, boolean][] = [["Revenue", "revenue", false, false], ["Cost of Sales", "cos", false, true], ["Gross Profit", "gross_profit", true, false], ["Expenses", "expenses", false, true], ["Operating Profit", "operating_profit", true, false], ["Other Income", "other_income", false, false], ["Other Expenses", "other_expenses", false, true], ["Earnings Before Interest & Tax", "ebit", true, false], ["Interest Income", "interest_income", false, false], ["Interest Expenses", "interest_expenses", false, true], ["Earnings Before Tax", "ebt", true, false], ["Tax Expenses", "tax_expenses", false, true], ["Net Income", "net_income", true, false]];
  return (
    <table className="tbl text-[11.5px]">
      <thead><tr><th>Profit &amp; Loss</th><th>{a.view.window.short}</th><th>{prior?.label ?? "Prior"}</th><th>Variance %</th><th>Common size</th><th>YTD</th></tr></thead>
      <tbody>{rows.map(([l, k, tot, cost]) => {
        const v = P[k] as number, p = prior ? (prior.P[k] as number) : null;
        const varPct = p ? ((v - p) / Math.abs(p)) * 100 : null;
        return (
          <tr key={k} className={cn(tot && "tot")}>
            <td>{l}</td><td>{money(v, cur)}</td><td>{p === null ? "–" : money(p, cur)}</td>
            <td className={varPct === null ? "text-mute" : (cost ? varPct <= 0 : varPct >= 0) ? "text-green-d" : "text-red"}>{varPct === null ? "–" : pct(varPct)}</td>
            <td>{P.revenue ? <><MiniPie p={(v / P.revenue) * 100} /> {pct((v / P.revenue) * 100, 0)}</> : "–"}</td>
            <td>{money(ytd[k] as number, cur)}</td>
          </tr>
        );
      })}</tbody>
    </table>
  );
}

function BSTable({ a, cur }: { a: Analysis; cur: string }) {
  const { B, prior } = a.view;
  const C = prior?.B ?? null;
  const rows: [string, keyof BSCalc | null, 0 | 1 | 2][] = [["ASSETS", null, 2], ["Cash & Equivalents", "cash", 0], ["Accounts Receivable", "ar", 0], ["Inventory", "inventory", 0], ["Work In Progress", "wip", 0], ["Other Current Assets", "other_ca", 0], ["Total Current Assets", "tca", 1], ["Fixed Assets", "fixed_assets", 0], ["Intangible Assets", "intangibles", 0], ["Investments / Other NCA", "investments", 0], ["Total Assets", "ta", 1], ["LIABILITIES", null, 2], ["Short Term Debt", "std", 0], ["Accounts Payable", "ap", 0], ["Tax Liability", "tax_liab", 0], ["Other Current Liabilities", "other_cl", 0], ["Total Current Liabilities", "tcl", 1], ["Long Term Debt", "ltd", 0], ["Other Non-Current Liabilities", "other_ncl", 0], ["Total Liabilities", "tl", 1], ["EQUITY", null, 2], ["Retained Earnings", "retained_earnings", 0], ["Other Equity", "other_equity", 0], ["Total Equity", "te", 1], ["Total Liabilities & Equity", "tle", 1]];
  return (
    <>
      {Math.abs(B.imbalance) > 0.5 && <p className="mb-2 text-right text-[12px] text-red">Out of balance by {money(B.imbalance, cur)}</p>}
      <table className="tbl text-[11.5px]">
        <thead><tr><th>Balance Sheet</th><th>{mlabel(a.view.window.end)}</th><th>{C ? prior!.label : "Prior"}</th><th>Variance</th><th>Common size</th></tr></thead>
        <tbody>{rows.map(([l, k, t]) => {
          if (t === 2) return <tr key={l} className="cat"><td colSpan={5}>{l}</td></tr>;
          const v = B[k!] as number, p = C ? (C[k!] as number) : null;
          if (t === 0 && !v && !p) return null;
          return (
            <tr key={l} className={cn(t === 1 && "tot")}>
              <td>{l}</td><td>{money(v, cur)}</td><td>{p === null ? "–" : money(p, cur)}</td>
              <td className={p === null ? "text-mute" : v - p >= 0 ? "text-green-d" : "text-red"}>{p === null ? "–" : money(v - p, cur)}</td>
              <td>{B.ta ? pct((v / B.ta) * 100, 0) : "–"}</td>
            </tr>
          );
        })}</tbody>
      </table>
    </>
  );
}

function Trend({ a, cur }: { a: Analysis; cur: string }) {
  const s = a.view.series;
  const labels = s.periods.map(mshort);
  const gt = a.targets.gpm ?? 35;
  const gpm = s.P.map((p) => (p.revenue ? (p.gross_profit / p.revenue) * 100 : null));
  return (
    <div className="space-y-3">
      <div><div className="label mb-1">Revenue</div><LineChart labels={labels} cur={cur} height={150} series={[{ name: "Revenue", values: s.P.map((p) => p.revenue), color: "#2a78d6", fill: true }]} /></div>
      <div><div className="label mb-1">Gross profit &amp; EBIT</div><LineChart labels={labels} cur={cur} height={160} series={[{ name: "Gross Profit", values: s.P.map((p) => p.gross_profit), color: "#1baf7a" }, { name: "EBIT", values: s.P.map((p) => p.ebit), color: "#eb6834" }]} /></div>
      <div><div className="label mb-1">Gross profit margin vs target {pct(gt, 0)}</div><LineChart labels={labels} cur={cur} unit="%" target={gt} height={160} marks={gpm.map((v) => (v === null ? null : v >= gt))} series={[{ name: "Gross Profit Margin", values: gpm, color: "#2a78d6" }]} /></div>
      <div><div className="label mb-1">Cash on hand</div><LineChart labels={labels} cur={cur} height={150} series={[{ name: "Cash", values: s.B.map((b) => b.cash), color: "#1baf7a", fill: true }]} /></div>
    </div>
  );
}

function Growth({ input, a, cur }: { input: ReportInput; a: Analysis; cur: string }) {
  const ms = [...input.months].sort((x, y) => x.period.localeCompare(y.period)).filter((m) => m.period <= a.view.window.end).slice(-13);
  if (ms.length < 2) return <p className="text-mute">Needs at least two months.</p>;
  const pts = ms.map((m) => ({ label: mlabel(m.period), x: bsCalc(m.bs).toi, y: plCalc(m.pl).ebit }));
  const q = quadrantOf(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y);
  return <><GrowthQuadrant points={pts} cur={cur} /><p className="mt-2 text-[12.5px]"><b>{q}</b> since {pts[0].label}: {QUADRANT_TEXT[q]}</p></>;
}

function Goalseek({ a }: { a: Analysis }) {
  const P = a.view.P;
  if (!P.revenue) return <p className="text-mute">No revenue in this period.</p>;
  const goal = a.targets.profit_ratio ?? 10;
  const start = (P.ebit / P.revenue) * 100;
  const g = start >= goal ? Math.ceil((start + 0.01) / 5) * 5 : goal;
  const t = goalseekTable(P, "profit_ratio", g);
  const lim = Math.max(10, ...t.filter((x) => x.band === "HIGH SENSITIVITY").map((x) => Math.abs(x.needed ?? 0))) * 1.15;
  return (
    <>
      <p className="mb-3 text-[13px]">Changes required to move the <b>{GOAL_KPIS[0].name}</b> from <b>{pct(start)}</b> to <b>{pct(g)}</b>{g !== goal ? " (stretch goal — the target is already met)" : ""}. Each row is the change in that one item alone.</p>
      {t.map((x) => {
        const w = x.needed === null ? 0 : Math.min((Math.abs(x.needed) / lim) * 50, 50);
        return (
          <div key={x.key} className="grid grid-cols-[130px_1fr_80px] items-center gap-3 border-b border-line py-1.5 text-[12px]">
            <div>{x.name} <span className="text-[10px] text-mute">{x.band.split(" ")[0].toLowerCase()}</span></div>
            <div className="relative h-2.5 bg-[#F4F4F1]"><div className="absolute -inset-y-1 left-1/2 w-px bg-[#bbb]" />{x.needed !== null && <div className="absolute inset-y-0 opacity-70" style={{ left: `${x.needed >= 0 ? 50 : 50 - w}%`, width: `${w}%`, background: LEVERS.find((l) => l.key === x.key)!.colour }} />}</div>
            <div className="num text-right">{x.needed === null ? "–" : pct(x.needed)}</div>
          </div>
        );
      })}
    </>
  );
}

function Basis({ input, a, cur }: { input: ReportInput; a: Analysis; cur: string }) {
  const inWindow = new Set(a.view.window.periods);
  const found = runChecks({ accounts: input.accounts, months: input.months }).filter((c) => c.period && inWindow.has(c.period) && c.severity !== "info");
  const failed = (id: CheckId) => found.filter((c) => c.id === id);
  const row = (name: string, ids: CheckId[], okText: string): [string, boolean, string] => {
    const f = ids.flatMap(failed);
    return [name, f.length === 0, f.length ? f.map((c) => `${mlabel(c.period!)}: ${c.diff !== undefined ? money(c.diff, cur) : c.title}`).join(" · ") : okText];
  };
  const checks: [string, boolean, string][] = [
    row("Balance sheet balances (assets = liabilities + equity)", ["bs_balance"], "difference within rounding"),
    row("Equity movement equals retained profit", ["re_rollforward"], a.view.B0 ? "reconciles" : "no opening balance sheet"),
    row("Cash flow reconciles to the change in cash without a balancing line", ["cash_flow"], a.CF ? "reconciles" : "no opening balance sheet"),
    row("Imported totals match the source file", ["control_total"], "match"),
    row("Every month in the period has data", ["gap"], a.view.complete ? "complete" : "some months missing"),
    ["Months of history loaded", input.months.length >= 13, `${input.months.length} months`],
  ];
  if (!a.view.complete && !failed("gap").length) checks[4] = ["Every month in the period has data", false, "some months in the period are missing"];
  const accepted = input.accepted ?? [];
  const defaults = Object.keys(input.settings.targets ?? {}).length === 0;
  return (
    <div className="space-y-5 text-[12.5px]">
      <table className="tbl"><tbody>{checks.map(([n, ok, d]) => <tr key={n}><td>{n}</td><td className={ok ? "text-green-d" : "text-red"}>{ok ? "✓" : "✕"}</td><td className="text-mute">{d}</td></tr>)}</tbody></table>
      <div><div className="label mb-1">Notes</div><ul className="list-disc space-y-1 pl-5">
        {(input.notes.length ? input.notes : ["No special adjustments were made to the source data."]).map((n) => <li key={n}>{n}</li>)}
        {accepted.map((x) => <li key={x.title + x.period}>Imported with a known issue ({x.period ? `${mlabel(x.period)}, ` : ""}{x.title.toLowerCase()}): {x.reason}</li>)}
        {defaults && <li>KPI targets are the standard defaults; set company-specific targets for sharper on/off-track scoring.</li>}
      </ul></div>
      <div className="rounded bg-band p-3 text-[11.5px] text-mute">{input.org.disclaimer}</div>
    </div>
  );
}
