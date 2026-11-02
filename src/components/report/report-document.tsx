"use client";
import { BS_LINES, PL_LINES, type Highlights } from "@/lib/engine/statement-rows";
import { cfRowCls, ChangeCell, Flag, flagReason, MarkButton, rowCls, StatementNotes } from "@/components/analysis/statement-ui";
import { emptyBS, markAt } from "@/lib/engine/statement-rows";
import { balanced } from "@/lib/tolerance";
import { Fragment, useMemo } from "react";
import {
  analyze, bsCalc, CAT_COL, CAT_ORDER, formatTrend, goalFor, goalseekTable, GOAL_KPIS, LEVERS, mlabel, money, mshort, pct, plCalc, quadrantOf, QUADRANT_TEXT,
  type Analysis, type Finding,
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
import { canPrintSales, ReportSales } from "./report-sales";
import { hasExpenses, ReportExpenses } from "./report-expenses";
import { SECTION_COMMENT, type ReportInput, type SectionKey } from "@/lib/report/types";
import { ReportBank, ReportBankOutlook, ReportRealProfit } from "./report-bank";
import { ReportForecast } from "./report-forecast";
import { useT } from "@/lib/i18n/use-t";
import { dirOf, htmlLang, monthNames } from "@/lib/i18n";
import { DEMO_NOTE } from "@/lib/company/demo-note";
import { inLang } from "@/lib/i18n/script";

type TT = ReturnType<typeof useT>;

const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FULL_MONTH_RE = new RegExp(`\\b(${FULL_MONTHS.join("|")})\\b`, "g");
/** "1 November 2026" (the date the report was prepared, written in English upstream) in the chosen language. */
export const dateIn = (s: string, T: TT) => (T.lang === "ar" ? s.replace(FULL_MONTH_RE, (m) => monthNames("ar")[FULL_MONTHS.indexOf(m) + 1]) : s);
/** The stored default title in the chosen language; a title the user typed stays as typed. */
export const titleIn = (title: string, T: TT) => (title === "Monthly Performance Report" ? T.d.rep.defaultTitle : title);

const AUTO_SECTIONS: Partial<Record<SectionKey, Finding["section"][]>> = { kpis: ["kpis"], profitability: ["profitability"], cashflow: ["cashflow"], trend: ["trend"], bs: ["bs"] };

/** A4-styled, print-ready management report. Used for the editor preview, the public link and PDF export. */
export function ReportDocument({ input }: { input: ReportInput }) {
  const T = useT();
  const t = T.d.rep.doc;
  const lang = T.lang;
  const kn = T.kn;
  const a = useMemo(() => analyze(input.months, input.sel, input.settings, { alerts: input.alerts, asOf: input.asOf, lang, kpiName: lang === "ar" ? kn : undefined }), [input.months, input.sel, input.settings, input.alerts, input.asOf, lang, kn]);
  const wl = T.pl(a.view.window.label);
  const cur = input.settings.currency;
  const brand = input.org.brandColour ?? "#0B6E70";
  // The Sales and Expenses pages are left out when there is nothing to show, rather than printed empty.
  const enabled = input.sections.filter((s) => s.enabled && (s.key !== "sales" || canPrintSales(input)) && (s.key !== "expenses" || hasExpenses(input))).map((s) => s.key);
  const comment = (k: SectionKey) => {
    const key = SECTION_COMMENT[k];
    const typed = key ? inLang(input.commentary[key], T.lang) : undefined;
    if (typed) return <div className="rcomment whitespace-pre-line">{typed}</div>;
    const fs = a.findings.filter((f) => AUTO_SECTIONS[k]?.includes(f.section)).slice(0, 3);
    if (!fs.length) return null;
    return <div className="rcomment"><div className="label mb-1">{T.d.ana.analystNotes}</div>{fs.map((f) => <div key={f.title} className="py-0.5"><b className="font-semibold">{f.title}.</b> {f.text}</div>)}</div>;
  };
  const head = (title: string, upto = false) => (
    <div className="rhead" style={{ borderColor: brand }}>
      <h2>{title}</h2>
      <div className="text-[12px] text-mute">{upto ? T.d.period.upto : T.d.period.for}<b className="text-ink">{wl}</b></div>
    </div>
  );
  const headOn = (title: string, label: string) => (
    <div className="rhead" style={{ borderColor: brand }}><h2>{title}</h2><div className="text-[12px] text-mute">{t.onThe}<b className="text-ink">{T.pl(label)}</b></div></div>
  );
  const sections: Record<SectionKey, () => React.ReactNode> = {
    cover: () => <Cover input={input} a={a} brand={brand} T={T} />,
    summary: () => <>{head(T.d.rep.secs.summary)}<Summary input={input} a={a} cur={cur} T={T} />{null}</>,
    kpis: () => <>{head(T.d.rep.secs.kpis)}<KpiTable a={a} cur={cur} T={T} />{comment("kpis")}</>,
    explorer: () => {
      const items = a.kpiRows.filter((r) => r.ok !== null).sort((x, y) => CAT_ORDER.indexOf(x.def.category) - CAT_ORDER.indexOf(y.def.category))
        .map((r) => ({ key: r.def.key, category: r.def.category, name: T.kn(r.def), ok: r.ok!, detail: "" }));
      const p = a.onTrack + a.offTrack ? (a.onTrack / (a.onTrack + a.offTrack)) * 100 : 0;
      return <>{head(T.d.rep.secs.explorer)}<KpiArc items={items} pctOn={p} period={T.pl(a.view.window.short)} /><p className="text-center text-[11px] text-mute">{t.explorerFoot(a.kpiRows.length, a.onTrack, a.offTrack)}</p></>;
    },
    profitability: () => <>{head(T.d.rep.secs.profitability)}<Profitability a={a} cur={cur} T={T} />{comment("profitability")}</>,
    cashflow: () => <>{head(T.d.rep.secs.cashflow)}{a.W ? <>
      <Tiles items={[[T.d.ana.ocf, a.W.ocf], [T.d.ana.fcf, a.W.fcf], [T.d.ana.ncf, a.W.ncf], [T.d.ana.dcash, a.W.dcash]]} cur={cur} />
      <CashWaterfall rows={a.W.rows} cur={cur} />
      <p className="mt-2 text-[10px] text-mute"><b>{t.ncfAlso}</b>{t.ncfCalc(money(a.W.dcash, cur), money(a.W.ddebt, cur))}</p>
    </> : <p className="text-mute">{t.needsOpeningPeriod}</p>}{comment("cashflow")}</>,
    pl: () => <>{head(T.d.rep.secs.pl)}<PLTable a={a} cur={cur} T={T} h={input.settings.highlights} />{comment("pl")}</>,
    bs: () => <>{head(T.d.rep.secs.bs)}<BSTable a={a} cur={cur} T={T} h={input.settings.highlights} />{comment("bs")}</>,
    cf: () => <>{head(T.d.rep.secs.cf)}{a.CF ? <table className="tbl text-[11.5px]"><tbody>
      {a.CF.lines.map((l, i) => l.heading ? <tr key={i} className="cat"><td colSpan={2}>{T.tl(l.label)}</td></tr> : <tr key={i} className={cfRowCls(l.label, l.total).replace("row", "").trim()}><td>{T.tl(l.label)}</td><td>{money(l.value, cur)}</td></tr>)}
    </tbody></table> : <p className="text-mute">{t.needsOpening}</p>}</>,
    trend: () => <>{head(T.d.rep.secs.trend, true)}<Trend a={a} cur={cur} T={T} />{comment("trend")}</>,
    growth: () => <>{head(T.d.rep.secs.growth, true)}<Growth input={input} a={a} cur={cur} T={T} />{comment("growth")}</>,
    goalseek: () => <>{head(T.d.rep.secs.goalseek)}<Goalseek a={a} T={T} />{comment("goalseek")}</>,
    forecast: () => <ReportForecast input={input} head={(h, l) => <div className="rhead" style={{ borderColor: brand }}><h2>{h}</h2><div className="text-[12px] text-mute">{t.fromLatest}<b className="text-ink">{l}</b></div></div>} />,
    sales: () => <ReportSales input={input} head={(t) => head(t)} />,
    expenses: () => <ReportExpenses input={input} head={(t) => head(t)} />,
    bank: () => <ReportBank input={input} head={headOn} />,
    bank_outlook: () => <ReportBankOutlook input={input} head={headOn} />,
    realprofit: () => <ReportRealProfit input={input} head={headOn} />,
    basis: () => <>{head(T.d.rep.secs.basis)}<Basis input={input} a={a} cur={cur} T={T} /></>,
  };
  return (
    <StaticCharts.Provider value>
      <div id="report" className="report" style={{ ["--brand" as string]: brand }} dir={dirOf(lang)} lang={htmlLang(lang)}>
        {enabled.map((k) => <section key={k} className={cn("rpage", k === "cover" && "rcover")} data-section={k}>{sections[k]()}</section>)}
      </div>
    </StaticCharts.Provider>
  );
}

function Cover({ input, a, brand, T }: { input: ReportInput; a: Analysis; brand: string; T: TT }) {
  return (
    <div className="flex h-full flex-col justify-between">
      <div className="h-2 w-full rounded" style={{ background: brand }} />
      <div className="py-24 text-center">
        {input.org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo is inlined as a data URL for PDF export
          <img src={input.org.logoUrl} alt="" className="mx-auto mb-8 h-14 object-contain" />
        ) : <div className="mb-8 text-sm font-semibold uppercase tracking-[0.2em] text-mute">{input.org.name}</div>}
        <h1 className="text-[40px] font-light leading-tight">{titleIn(input.title, T)}</h1>
        <div className="mt-3 text-lg">{input.companyName}</div>
        <div className="mt-1 text-mute">{T.pl(a.view.window.label)}</div>
      </div>
      <div className="text-center text-[11px] text-mute">{T.d.rep.doc.prepared(dateIn(input.preparedOn, T), input.org.name)}</div>
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

function Summary({ input, a, cur, T }: { input: ReportInput; a: Analysis; cur: string; T: TT }) {
  const t = T.d.ana;
  const { P, B, B0, prior, series } = a.view;
  const pr = prior ? T.pl(prior.label) : T.d.rep.doc.prior;
  const score = a.onTrack + a.offTrack ? (a.onTrack / (a.onTrack + a.offTrack)) * 100 : 0;
  const ch = (x: number, y?: number | null) => (y ? ((x - y) / Math.abs(y)) * 100 : null);
  const d = (v: number | null, cost = false) => v === null ? <span className="text-mute">–</span> : <span className={(cost ? v <= 0 : v >= 0) ? "text-green-d" : "text-red"}>{v > 0 ? "▲" : "▼"} {Math.abs(v).toFixed(1)}%</span>;
  const s12P = series.P.slice(-12), s12B = series.B.slice(-12);
  const hero: [string, string, React.ReactNode, (number | null)[], boolean][] = [
    [t.revenue, money(P.revenue, cur), <>{d(ch(P.revenue, prior?.P.revenue))} <span className="text-mute">{t.vs(pr)}</span></>, s12P.map((p) => p.revenue), P.revenue < 0],
    [t.grossMargin, pct(a.K.gpm, 1), <span key="t" className="text-mute">{t.target(pct(a.targets.gpm ?? 35, 0))}</span>, s12P.map((p) => (p.revenue ? (p.gross_profit / p.revenue) * 100 : null)), (a.K.gpm ?? 0) < (a.targets.gpm ?? 35)],
    [t.ebit, money(P.ebit, cur), <>{d(ch(P.ebit, prior?.P.ebit))} <span className="text-mute">{t.vs(pr)}</span></>, s12P.map((p) => p.ebit), P.ebit < 0],
    [t.cashOnHand, money(B.cash, cur), B0 ? <>{d(ch(B.cash, B0.cash))} <span className="text-mute">{t.vsOpening}</span></> : null, s12B.map((b) => b.cash), B.cash < 0],
  ];
  // Without a balance sheet (a cash book, a P&L on its own) there is no cash figure to state.
  const hasBS = input.months.some((m) => m.has?.bs ?? true);
  const headline = input.commentary.summary ||
    t.headline(input.companyName, P.ebit >= 0, money(Math.abs(P.ebit), cur), money(P.revenue, cur), T.pl(a.view.window.label), a.onTrack, a.onTrack + a.offTrack, hasBS ? money(B.cash, cur) : null);
  const finds = (kind: Finding["kind"]) => {
    const l = a.findings.filter((f) => f.kind === kind).slice(0, 4);
    return l.length ? l.map((f) => (
      <div key={f.title} className="grid grid-cols-[12px_1fr] gap-2 border-b border-line py-1.5 text-[12px]">
        <span className={cn("mt-1 h-2 w-2 rounded-full", kind === "risk" ? "bg-red" : kind === "watch" ? "bg-amber" : "bg-green")} />
        <div><b className="font-semibold">{f.title}</b><div className="text-mute">{f.text}</div></div>
      </div>
    )) : <div className="py-1.5 text-[12px] text-mute">{t.nothing}</div>;
  };
  return (
    <>
      <div className="mb-4 flex items-center gap-5 bg-band px-4 py-3">
        <div className={cn("text-[42px] font-light leading-none", score >= 60 ? "text-green-d" : "text-red")}>{Math.round(score)}%</div>
        <div><b className="font-semibold">{t.kpisOnTrack}</b><div className="text-[12px] text-mute">{T.d.rep.doc.track(a.onTrack, a.offTrack)}</div></div>
      </div>
      <p className="mb-5 whitespace-pre-line text-[14.5px] leading-relaxed">{headline}</p>
      <div className="mb-5 grid grid-cols-4 gap-4">
        {hero.map(([l, v, dd, sp, neg]) => (
          <div key={l} className={cn("border-t-[3px] pt-1.5", neg ? "border-red" : "border-green")}>
            <div className="label">{l}</div><div className="num whitespace-nowrap text-[17px]">{v}</div><div className="text-[11px]">{dd}</div>
            <Sparkline values={sp} w={120} h={28} color={neg ? "#D9343A" : "#2E9E6A"} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div><h3 className="mb-1 text-base font-normal">{t.risk}</h3>{finds("risk")}<h3 className="mb-1 mt-4 text-base font-normal">{t.watch}</h3>{finds("watch")}</div>
        <div><h3 className="mb-1 text-base font-normal">{t.win}</h3>{finds("win")}</div>
      </div>
    </>
  );
}

function KpiTable({ a, cur, T }: { a: Analysis; cur: string; T: TT }) {
  const t = T.d.rep.doc;
  return (
    <table className="tbl text-[11.5px]">
      <thead><tr><th>{t.kpi}</th><th>{t.result}</th><th>{t.target}</th><th></th><th>{t.vsTarget}</th><th>{t.importance}</th></tr></thead>
      <tbody>
        {CAT_ORDER.map((cat) => {
          const rows = a.kpiRows.filter((r) => r.def.category === cat);
          if (!rows.length) return null;
          return (
            <Fragment key={cat}>
              <tr className="cat"><td colSpan={6}><span className="me-1.5 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CAT_COL[cat] }} />{T.tl(cat)}</td></tr>
              {rows.map((r) => (
                <tr key={r.def.key}>
                  <td>{r.alert && <span className="me-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red align-middle" />}{T.kn(r.def)}{r.def.direction === "down" ? "*" : ""}</td>
                  <td>{T.num(r.value, r.def.unit, cur)}</td><td className="text-mute">{T.num(r.compare, r.def.unit, cur)}</td>
                  <td className="text-center"><StatusIcon ok={r.ok} /></td>
                  <td>{r.trend ? <span className={r.ok ? "text-green-d" : "text-red"}>{r.trend.value > 0 ? "▲" : "▼"} {formatTrend(r.trend, cur).replace(/ pp$/, T.d.ana.pp)}</span> : "–"}</td>
                  <td>{T.tl(r.importance)}</td>
                </tr>
              ))}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function Profitability({ a, cur, T }: { a: Analysis; cur: string; T: TT }) {
  const t = T.d.rep.doc;
  const { P } = a.view;
  const b = a.breakeven;
  return (
    <>
      <Tiles items={[[T.d.ana.grossProfit, P.gross_profit], [T.d.ana.operatingProfit, P.operating_profit], [T.d.ana.ebit, P.ebit]]} cur={cur} />
      {b.ok ? (
        <div className="grid grid-cols-[1.35fr_1fr] items-start gap-5">
          <BreakevenChart revenue={b.revenue} fixed={b.fixedCosts} vcr={b.vcr} bep={b.bep} cur={cur} />
          <div className="space-y-3 text-[13px]">
            {[[t.revenue, money(b.revenue, cur)], [t.totalCosts, money(b.totalCosts, cur)], [t.bep, money(b.bep, cur)], [T.d.ana.mos, `${money(b.mos, cur)} (${b.mosPct.toFixed(0)}%)`], [t.variableCosts, t.perRev(cur, b.vcr.toFixed(2))], [t.fixedCosts, money(b.fixedCosts, cur)]].map(([l, v]) => (
              <div key={l}><div className="label">{l}</div><div className="num text-[17px]">{v}</div></div>
            ))}
          </div>
        </div>
      ) : <p className="text-mute">{t.noBreakeven}</p>}
    </>
  );
}

/** The report's statements: the same lines, shading, better/worse cells, flags and colour marks as the Financials page. */
function PLTable({ a, cur, T, h }: { a: Analysis; cur: string; T: TT; h?: Highlights }) {
  const t = T.d.rep.doc;
  const { P, prior, ytd } = a.view;
  const fmt = (v: number) => money(v, cur);
  const rows = PL_LINES.filter((r) => !r.ifAdjusted || P.adjustments || prior?.P.adjustments);
  const notes: { label: string; text: string }[] = [];
  return (
    <>
    <table className="tbl text-[11.5px]">
      <thead><tr><th>{T.tl("Profit & Loss")}</th><th>{T.pl(a.view.window.short)}</th><th>{prior ? T.pl(prior.label) : t.priorCol}</th><th>{T.d.ana.variancePct}</th><th>{t.commonSize}</th><th>{T.d.ana.ytd}</th></tr></thead>
      <tbody>{rows.map(({ l, k }) => {
        const v = P[k] as number, p = prior ? (prior.P[k] as number) : null;
        const why = flagReason("PL", k, v, p, h, fmt, T);
        const mark = markAt(h?.lines, k);
        noteFor(notes, T.tl(l), why, mark?.note);
        return (
          <tr key={k} className={rowCls(k, { base: "", mark, flagged: !!why })} data-line={k}>
            <td>{T.tl(l)}<Flag reason={why} /><MarkButton markKey={k} mark={mark} canEdit={false} onSave={noSave} label={T.tl(l)} /></td><td>{money(v, cur)}</td><td>{p === null ? "–" : money(p, cur)}</td>
            <ChangeCell statement="PL" k={k} cur={v} cmp={p} kind="pct" fmt={fmt} />
            <td>{P.revenue ? <><MiniPie p={(v / P.revenue) * 100} /> {pct((v / P.revenue) * 100, 0)}</> : "–"}</td>
            <td>{money(ytd[k] as number, cur)}</td>
          </tr>
        );
      })}</tbody>
    </table>
    <StatementNotes notes={notes} />
    </>
  );
}

/** A line's ⚠ reason and its editor's note, printed under the table. */
function noteFor(notes: { label: string; text: string }[], label: string, why: string | null, note?: string) {
  const text = [why, note].filter(Boolean).join(" · ");
  if (text) notes.push({ label, text });
}

function BSTable({ a, cur, T, h }: { a: Analysis; cur: string; T: TT; h?: Highlights }) {
  const t = T.d.rep.doc;
  const { B, prior } = a.view;
  // A comparison month with no balance sheet loaded is no comparison (not a balance sheet of zeros).
  const C = prior && !emptyBS(prior.B) ? prior.B : null;
  const fmt = (v: number) => money(v, cur);
  const notes: { label: string; text: string }[] = [];
  return (
    <>
      {!balanced(B.imbalance) && <p className="mb-2 text-end text-[12px] text-red">{T.d.ana.outOfBalance(money(B.imbalance, cur))}</p>}
      <table className="tbl text-[11.5px]">
        <thead><tr><th>{T.tl("Balance Sheet")}</th><th>{T.ml(a.view.window.end)}</th><th>{C ? T.pl(prior!.label) : t.priorCol}</th><th>{t.variance}</th><th>{t.commonSize}</th></tr></thead>
        <tbody>{BS_LINES.map(({ l, k, typ }) => {
          if (typ === 2 || !k) return <tr key={l} className="cat"><td colSpan={5}>{T.tl(l)}</td></tr>;
          const v = B[k] as number, p = C ? (C[k] as number) : null;
          if (typ === 0 && !v && !p) return null;
          const why = flagReason("BS", k, v, p, h, fmt, T);
          const mark = markAt(h?.lines, k);
          noteFor(notes, T.tl(l), why, mark?.note);
          return (
            <tr key={l} className={rowCls(k, { base: "", mark, flagged: !!why })} data-line={k}>
              <td>{T.tl(l)}<Flag reason={why} /><MarkButton markKey={k} mark={mark} canEdit={false} onSave={noSave} label={T.tl(l)} /></td><td>{money(v, cur)}</td><td>{p === null ? "–" : money(p, cur)}</td>
              <ChangeCell statement="BS" k={k} cur={v} cmp={p} kind="money" fmt={fmt} />
              <td>{B.ta ? pct((v / B.ta) * 100, 0) : "–"}</td>
            </tr>
          );
        })}</tbody>
      </table>
      <StatementNotes notes={notes} />
    </>
  );
}
const noSave = async () => ({ ok: false });

function Trend({ a, cur, T }: { a: Analysis; cur: string; T: TT }) {
  const t = T.d.rep.doc;
  const s = a.view.series;
  const labels = s.periods.map((p) => (T.lang === "ar" ? T.ms(p) : mshort(p)));
  const gt = a.targets.gpm ?? 35;
  const gpm = s.P.map((p) => (p.revenue ? (p.gross_profit / p.revenue) * 100 : null));
  return (
    <div className="space-y-3">
      <div><div className="label mb-1">{t.revenue}</div><LineChart labels={labels} cur={cur} height={150} series={[{ name: "Revenue", values: s.P.map((p) => p.revenue), color: "#2a78d6", fill: true }]} /></div>
      <div><div className="label mb-1">{t.gpEbit}</div><LineChart labels={labels} cur={cur} height={160} series={[{ name: "Gross Profit", values: s.P.map((p) => p.gross_profit), color: "#1baf7a" }, { name: "EBIT", values: s.P.map((p) => p.ebit), color: "#eb6834" }]} /></div>
      <div><div className="label mb-1">{t.gpmVsTarget(pct(gt, 0))}</div><LineChart labels={labels} cur={cur} unit="%" target={gt} height={160} marks={gpm.map((v) => (v === null ? null : v >= gt))} series={[{ name: T.lang === "ar" ? t.gpm : "Gross Profit Margin", values: gpm, color: "#2a78d6" }]} /></div>
      <div><div className="label mb-1">{T.d.ana.cashOnHand}</div><LineChart labels={labels} cur={cur} height={150} series={[{ name: T.lang === "ar" ? t.cash : "Cash", values: s.B.map((b) => b.cash), color: "#1baf7a", fill: true }]} /></div>
    </div>
  );
}

function Growth({ input, a, cur, T }: { input: ReportInput; a: Analysis; cur: string; T: TT }) {
  const ms = [...input.months].sort((x, y) => x.period.localeCompare(y.period)).filter((m) => m.period <= a.view.window.end).slice(-13);
  if (ms.length < 2) return <p className="text-mute">{T.d.rep.doc.needTwo}</p>;
  const pts = ms.map((m) => ({ label: T.lang === "ar" ? T.ml(m.period) : mlabel(m.period), x: bsCalc(m.bs).toi, y: plCalc(m.pl).ebit }));
  const q = quadrantOf(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y);
  return <><GrowthQuadrant points={pts} cur={cur} /><p className="mt-2 text-[12.5px]"><b>{T.lang === "ar" ? T.d.ana.quadrants[q][0] : q}</b>{T.d.rep.doc.since(pts[0].label)}{T.lang === "ar" ? T.d.ana.quadrants[q][1] : QUADRANT_TEXT[q]}</p></>;
}

function Goalseek({ a, T }: { a: Analysis; T: TT }) {
  const tw = T.d.rep.doc;
  const gs = T.d.plan.gs;
  const P = a.view.P;
  if (!P.revenue) return <p className="text-mute">{tw.noRevenue}</p>;
  const goal = a.targets.profit_ratio ?? 10;
  const start = (P.ebit / P.revenue) * 100;
  const g = goalFor(start, goal).goal;
  const t = goalseekTable(P, "profit_ratio", g);
  const lim = Math.max(10, ...t.filter((x) => x.band === "HIGH SENSITIVITY").map((x) => Math.abs(x.needed ?? 0))) * 1.15;
  return (
    <>
      <p className="mb-3 text-[13px]">{tw.gsIntro(T.lang === "ar" ? gs.kpis[GOAL_KPIS[0].key] ?? GOAL_KPIS[0].name : GOAL_KPIS[0].name, pct(start), pct(g), g !== goal).map((x, i) => (i % 2 ? <b key={i}>{x}</b> : x))}</p>
      {t.map((x) => {
        const w = x.needed === null ? 0 : Math.min((Math.abs(x.needed) / lim) * 50, 50);
        return (
          <div key={x.key} className="grid grid-cols-[130px_1fr_80px] items-center gap-3 border-b border-line py-1.5 text-[12px]">
            <div>{T.lang === "ar" ? gs.levers[x.key] ?? T.tl(x.name) : x.name} <span className="text-[10px] text-mute">{T.lang === "ar" ? tw.band[x.band.split(" ")[0].toLowerCase()] : x.band.split(" ")[0].toLowerCase()}</span></div>
            <div dir="ltr" className="relative h-2.5 bg-[#F4F4F1]"><div className="absolute -inset-y-1 left-1/2 w-px bg-[#bbb]" />{x.needed !== null && <div className="absolute inset-y-0 opacity-70" style={{ left: `${x.needed >= 0 ? 50 : 50 - w}%`, width: `${w}%`, background: LEVERS.find((l) => l.key === x.key)!.colour }} />}</div>
            <div className="num text-end">{x.needed === null ? "–" : pct(x.needed)}</div>
          </div>
        );
      })}
    </>
  );
}

function Basis({ input, a, cur, T }: { input: ReportInput; a: Analysis; cur: string; T: TT }) {
  const t = T.d.rep.doc;
  const inWindow = new Set(a.view.window.periods);
  const found = runChecks({ accounts: input.accounts, months: input.months }).filter((c) => c.period && inWindow.has(c.period) && c.severity !== "info");
  const failed = (id: CheckId) => found.filter((c) => c.id === id);
  const row = (name: string, ids: CheckId[], okText: string): [string, boolean, string] => {
    const f = ids.flatMap(failed);
    return [name, f.length === 0, f.length ? f.map((c) => `${T.ml(c.period!)}: ${c.diff !== undefined ? money(c.diff, cur) : c.title}`).join(" · ") : okText];
  };
  const checks: [string, boolean, string][] = [
    row(t.checks.bs, ["bs_balance"], t.rounding),
    row(t.checks.re, ["re_rollforward"], a.view.B0 ? t.reconciles : t.noOpening),
    row(t.checks.cf, ["cash_flow"], a.CF ? t.reconciles : t.noOpening),
    row(t.checks.ct, ["control_total"], t.match),
    row(t.checks.gap, ["gap"], a.view.complete ? t.complete : t.someMissing),
    [t.checks.hist, input.months.length >= 13, t.months(input.months.length)],
  ];
  if (!a.view.complete && !failed("gap").length) checks[4] = [t.checks.gap, false, t.someMissingPeriod];
  const accepted = input.accepted ?? [];
  const defaults = Object.keys(input.settings.targets ?? {}).length === 0;
  return (
    <div className="space-y-5 text-[12.5px]">
      <table className="tbl"><tbody>{checks.map(([n, ok, d]) => <tr key={n}><td>{n}</td><td className={ok ? "text-green-d" : "text-red"}>{ok ? "✓" : "✕"}</td><td className="text-mute">{d}</td></tr>)}</tbody></table>
      <div><div className="label mb-1">{t.notes}</div><ul className="list-disc space-y-1 ps-5">
        {(input.notes.length ? input.notes : [t.noAdjust]).map((n) => <li key={n}>{n === DEMO_NOTE ? t.demoNote : n}</li>)}
        {accepted.map((x) => <li key={x.title + x.period}>{t.known(x.period ? `${T.ml(x.period)}, ` : "", x.title.toLowerCase(), x.reason)}</li>)}
        {defaults && <li>{t.defaults}</li>}
      </ul></div>
      <div className="rounded bg-band p-3 text-[11.5px] text-mute">{input.org.disclaimer}</div>
    </div>
  );
}
