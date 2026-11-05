"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useCompany } from "@/lib/company/context";
import { useT } from "@/lib/i18n/use-t";
import { money } from "@/lib/engine/format";
import { BENCHMARK_AS_OF, EGYPT_AS_OF, SECTORS, valueCompany, type Adjustment, type Purpose, type Sector, type ValuationSettings } from "@/lib/engine/valuation";
import { valuationInputs } from "@/lib/valuation/inputs";
import { plainNumber } from "@/lib/valuation/number";
import { saveValuationSettings } from "@/app/company/[id]/value/actions";
import { PageHeader } from "@/components/shell/page-header";
import { Cockpit, HeroKpi, KpiTile } from "@/components/viz/kpi";
import { CardGrid, ChartCard } from "@/components/viz/chart-card";
import { Bridge } from "@/components/viz/bridge";
import { FootballField } from "./football-field";
import { cn } from "@/lib/cn";

type Tab = "overview" | "methods" | "assumptions";
const PURPOSES: Purpose[] = ["owner", "sale", "bank", "partners"];
const pc = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

export function ValueView({ tab, companyId, demo, saved, topCustomerShare }: {
  tab: Tab; companyId?: string; demo?: boolean; saved: ValuationSettings; topCustomerShare: number | null;
}) {
  const c = useCompany();
  const T = useT();
  const t = T.d.val;
  const cur = c.settings.currency;
  const [s, setS] = useState<ValuationSettings>(saved);
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const inputs = useMemo(() => {
    const i = valuationInputs(c, null);
    return i ? { ...i, quality: { ...i.quality, topCustomerShare } } : null;
  }, [c, topCustomerShare]);
  const v = useMemo(() => (inputs ? valueCompany(inputs, s) : null), [inputs, s]);
  const fmt = (x: number) => money(x, cur, true);
  const base = demo ? "/demo/value" : `/company/${companyId}/value`;
  const canEdit = !demo && !c.readOnly;

  const head = (
    <PageHeader title={t.title} right={
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1"><span className="text-xs text-mute">{t.purpose}</span>
          <select className="rounded-md border border-line bg-white px-2 py-1.5" value={s.purpose} onChange={(e) => setS({ ...s, purpose: e.target.value as Purpose })} data-testid="value-purpose">
            {PURPOSES.map((p) => <option key={p} value={p}>{t.purposes[p]}</option>)}
          </select></label>
        <label className="grid gap-1"><span className="text-xs text-mute">{t.sector}</span>
          <select className="rounded-md border border-line bg-white px-2 py-1.5" value={s.sector} onChange={(e) => setS({ ...s, sector: e.target.value as Sector })} data-testid="value-sector">
            {SECTORS.map((k) => <option key={k} value={k}>{t.sectors[k]}</option>)}
          </select></label>
      </div>
    }><p className="mt-2 max-w-3xl text-sm text-mute">{t.intro}</p></PageHeader>
  );
  if (!inputs || !v) return <div>{head}<p className="rounded-md border border-line p-4 text-sm" data-testid="value-empty">{t.noData}</p></div>;

  const label = (k: string) => t.methods[k]?.[0] ?? k;
  const reason = (r?: string) => (r ? t.reasons[r] ?? r : "");
  const weightOf = (k: string) => v.best.weights[k as keyof typeof v.best.weights] ?? 0;
  const tabs: { k: Tab; href: string; label: string }[] = [
    { k: "overview", href: base, label: t.title },
    { k: "methods", href: `${base}/methods`, label: t.methodsTitle },
    { k: "assumptions", href: `${base}/assumptions`, label: t.assumptionsTitle },
  ];

  return (
    <div data-testid="value-page">
      {head}
      {demo && <p className="mb-4 rounded-md bg-amber/10 p-3 text-sm" role="status">{t.demoNote}</p>}
      <nav aria-label={t.title} className="mb-6 flex flex-wrap gap-2 text-sm">
        {tabs.map((x) => <Link key={x.k} href={x.href} aria-current={x.k === tab ? "page" : undefined} className={cn("rounded-full border px-3 py-1", x.k === tab ? "border-brand bg-brand/10 font-medium" : "border-line")}>{x.label}</Link>)}
      </nav>

      {tab === "overview" && <>
        <Cockpit testId="value-cockpit" hero={
          <HeroKpi label={t.best} value={<span data-testid="value-best">{fmt(v.best.mid)}</span>} testId="value-hero" story={<>
            <span className="block">{t.range(fmt(v.best.low), fmt(v.best.high))}</span>
            {v.usd && <span className="block text-mute">{t.usd(money(v.usd.low, "USD", true), money(v.usd.high, "USD", true))}</span>}
            <span className="block text-mute">{t.basis(T.lang === "ar" ? t.window(Math.round(inputs.covered * 10) / 10, T.ml(inputs.end)) : v.label)}</span>
          </>} />
        }>
          <KpiTile label={t.cap.wacc} value={pc(v.capital.wacc)} testId="value-wacc" />
          <KpiTile label={t.quality} value={t.qualityOf(v.quality.score, v.quality.grade)} accent={v.quality.score >= 65 ? "good" : "bad"} testId="value-quality" />
          <KpiTile label={t.normalised} value={fmt(v.normalised.ebitda)} sub={t.ebitda} />
          <KpiTile label={t.methods.dcf[0]} value={v.dcf ? fmt(v.dcf.ev) : "–"} sub={t.bridgeRows.ev} />
        </Cockpit>
        <ChartCard title={t.football} sub={t.footballSub} wide testId="value-football">
          <FootballField methods={v.methods} best={v.best} label={label} fmt={fmt} reason={reason} weightOf={weightOf} />
        </ChartCard>
        <CardGrid>
          <ChartCard title={t.bridge} sub={t.bridgeSub} testId="value-bridge">
            {v.bridge.length ? <Bridge cur={cur} rows={v.bridge.filter((r) => r.value !== 0 || r.key === "ev" || r.key === "equity").map((r) => ({ label: t.bridgeRows[r.key], value: r.value, total: r.key === "ev" || r.key === "equity" }))} /> : <p className="text-sm text-mute">{reason(v.methods.find((m) => m.key === "dcf")?.reason)}</p>}
          </ChartCard>
          <ChartCard title={t.quality} sub={t.qualityHow} testId="value-quality-card">
            <p className="mb-3 text-2xl num">{t.qualityOf(v.quality.score, v.quality.grade)}</p>
            <ul className="space-y-1 text-sm">{v.quality.deductions.map((d) => <li key={d.key} className="flex justify-between gap-3"><span>{t.deductions[d.key]}</span><span className="num text-red">−{d.points}</span></li>)}</ul>
          </ChartCard>
        </CardGrid>
        <section className="mb-8 rounded-lg border border-line p-4" data-testid="value-limits" aria-labelledby="value-limits-h">
          <h2 id="value-limits-h" className="mb-3 text-lg">{t.limitsTitle}</h2>
          <ul className="space-y-2 text-sm">{v.limits.map((l) => (
            <li key={l.key} className="flex flex-wrap items-baseline justify-between gap-2" data-testid={`limit-${l.key}`}>
              <span>{t.limits[l.key](l.n ?? 0)}</span><span className={cn("text-xs", l.effect === "lower" ? "text-red" : "text-mute")}>{t.effects[l.effect]}</span>
            </li>))}</ul>
        </section>
      </>}

      {tab === "methods" && <div data-testid="value-methods">
        <CardGrid>
          {v.methods.map((m) => (
            <ChartCard key={m.key} title={label(m.key)} sub={t.methods[m.key]?.[1]} testId={`method-${m.key}`}>
              {m.value ? (
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  {(["low", "mid", "high"] as const).map((k) => <div key={k}><dt className="text-xs text-mute">{t[k]}</dt><dd className="num">{fmt(m.value![k])}</dd></div>)}
                </dl>
              ) : <p className="text-sm text-mute">{reason(m.reason)}</p>}
              <p className="mt-2 text-xs text-mute">{t.weight}: {weightOf(m.key) > 0 ? pc(weightOf(m.key), 0) : t.notWeighed}</p>
            </ChartCard>
          ))}
        </CardGrid>
        <ChartCard title={t.capital} wide testId="value-capital">
          <table className="w-full text-sm"><tbody>
            {(["riskFree", "longRiskFree", "equityPremium", "beta", "sizePremium", "specificPremium", "costOfEquity", "costOfDebt", "afterTaxDebt", "debtWeight", "wacc", "terminalWacc", "longGrowth"] as const).map((k) => (
              <tr key={k} className="border-b border-line/60"><td className="py-1.5">{t.cap[k]}</td><td className="py-1.5 text-end num">{k === "beta" ? v.capital.beta.toFixed(2) : pc(v.capital[k])}</td></tr>))}
          </tbody></table>
        </ChartCard>
        {v.dcf && <ChartCard title={t.projection} wide testId="value-projection">
          <div className="overflow-x-auto" role="region" aria-label={t.projection} tabIndex={0}>
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-xs text-mute"><th className="text-start">{t.year}</th><th className="text-end">{t.revenue}</th><th className="text-end">{t.ebitda}</th><th className="text-end">{t.fcf}</th><th className="text-end">{t.pv}</th></tr></thead>
              <tbody>{v.dcf.years.map((y) => <tr key={y.year} className="border-b border-line/60"><td>{y.year}</td><td className="text-end num">{fmt(y.revenue)}</td><td className="text-end num">{fmt(y.ebitda)}</td><td className="text-end num">{fmt(y.fcf)}</td><td className="text-end num">{fmt(y.pv)}</td></tr>)}
                <tr><td>{t.terminal}</td><td colSpan={2} className="text-end text-xs text-mute">{t.terminalShare(Math.round(v.dcf.terminalShare * 100))} · {t.exitMultiple(v.dcf.impliedExitMultiple.toFixed(1))}</td><td className="text-end num">{fmt(v.dcf.terminal)}</td><td className="text-end num">{fmt(v.dcf.pvTerminal)}</td></tr>
              </tbody>
            </table>
          </div>
        </ChartCard>}
        {v.dcf && <ChartCard title={t.grid} sub={t.gridSub} wide testId="value-grid">
          <div className="overflow-x-auto" role="region" aria-label={t.grid} tabIndex={0}>
            <table className="w-full min-w-[480px] text-sm num" dir="ltr">
              <thead><tr><th className="text-xs text-mute">{t.gridHead}</th>{v.grid.growth.map((g) => <th key={g} className="text-end text-xs text-mute">{pc(g)}</th>)}</tr></thead>
              <tbody>{v.grid.wacc.map((w, i) => <tr key={w}><th className="text-start text-xs text-mute">{pc(w)}</th>{v.grid.value[i].map((x, j) => <td key={j} className={cn("text-end", i === 2 && j === 2 && "font-semibold text-brand-d")}>{x == null ? "–" : fmt(x)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </ChartCard>}
        <p className="mt-4 text-xs text-mute">{t.benchmark(T.ml(BENCHMARK_AS_OF))}</p>
      </div>}

      {tab === "assumptions" && <Assumptions s={s} setS={setS} v={v} cur={cur} canEdit={canEdit} busy={busy} msg={msg}
        onSave={() => companyId && start(async () => { const r = await saveValuationSettings(companyId, s); setMsg(r.ok ? { ok: true, text: t.saved } : { ok: false, text: r.error === "badField" ? t.badField : r.error }); })}
        onReset={() => setS({ purpose: s.purpose, sector: s.sector })} />}

      <p className="mt-8 text-xs text-mute" data-testid="value-disclaimer">{t.disclaimer}</p>
    </div>
  );
}

type Num = "riskFree" | "longRiskFree" | "equityPremium" | "beta" | "sizePremium" | "longGrowth" | "growth" | "targetMargin" | "privateDiscount"
  | "multEbitda" | "multSales" | "multPe" | "ownerPay" | "arOver180" | "slowStock" | "fx";
const PCT: Num[] = ["riskFree", "longRiskFree", "equityPremium", "sizePremium", "longGrowth", "growth", "targetMargin", "privateDiscount"];

const COMPLETE = /^-?\d+(\.\d+)?$/;

/**
 * A number box that keeps what is typed ("12.", "-", "٠٫٥") and passes the value on only once it is a whole number,
 * so nothing typed is lost; on leaving the box an unfinished entry goes back to the last value.
 */
function NumberBox({ value, onValue, label, placeholder, testId, className }: {
  value: number | undefined; onValue: (v: number | undefined) => void; label: string; placeholder?: string; testId?: string; className?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value == null ? "" : String(value));
  return (
    <input aria-label={label} inputMode="decimal" className={className} value={shown} placeholder={placeholder} data-testid={testId}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const p = plainNumber(raw);
        if (p === "") onValue(undefined);
        else if (COMPLETE.test(p)) onValue(Number(p));
      }}
      onBlur={() => setText(null)} />
  );
}

function Assumptions({ s, setS, v, cur, canEdit, busy, msg, onSave, onReset }: {
  s: ValuationSettings; setS: (s: ValuationSettings) => void; v: NonNullable<ReturnType<typeof valueCompany>>; cur: string; canEdit: boolean; busy: boolean;
  msg: { ok: boolean; text: string } | null; onSave: () => void; onReset: () => void;
}) {
  const T = useT();
  const t = T.d.val;
  const defaults: Record<Num, string> = {
    riskFree: pc(v.capital.riskFree), equityPremium: pc(v.capital.equityPremium), beta: v.capital.beta.toFixed(2), sizePremium: pc(v.capital.sizePremium),
    longGrowth: pc(v.capital.longGrowth), growth: pc(v.assumptions.growth), targetMargin: pc(v.assumptions.targetMargin), privateDiscount: pc(v.assumptions.privateDiscount),
    ownerPay: money(0, cur), arOver180: money(0, cur), slowStock: money(0, cur), fx: "–",
    longRiskFree: pc(v.capital.longRiskFree),
    multEbitda: `${v.assumptions.multiples.evEbitda.mid}×`, multSales: `${v.assumptions.multiples.evSales.mid}×`, multPe: `${v.assumptions.multiples.pe.mid}×`,
  };
  const ORDER: Num[] = ["riskFree", "longRiskFree", "equityPremium", "beta", "sizePremium", "longGrowth", "growth", "targetMargin", "privateDiscount", "multEbitda", "multSales", "multPe", "ownerPay", "arOver180", "slowStock", "fx"];
  const set = (k: Num, n: number | undefined) => {
    const next = { ...s } as Record<string, unknown>;
    if (n === undefined) delete next[k]; else next[k] = PCT.includes(k) ? n / 100 : n;
    setS(next as unknown as ValuationSettings);
  };
  const shown = (k: Num) => { const x = s[k]; return x == null ? undefined : PCT.includes(k) ? Math.round(x * 10000) / 100 : x; };
  const adj = s.adjustments ?? [];
  const setAdj = (a: Adjustment[]) => setS({ ...s, adjustments: a.length ? a : undefined });
  return (
    <div data-testid="value-assumptions">
      <p className="mb-4 max-w-3xl text-sm text-mute">{t.assumptionsIntro} {t.ratesAsOf(T.ml(EGYPT_AS_OF))}</p>
      <p className="sticky top-0 z-10 mb-4 rounded-md border border-line bg-white p-3 text-sm" aria-live="polite">{t.best}: <b className="num" data-testid="va-best">{money(v.best.mid, cur, true)}</b> <span className="text-mute">({t.range(money(v.best.low, cur, true), money(v.best.high, cur, true))})</span></p>
      {!canEdit && <p className="mb-4 text-sm text-mute" role="status">{t.viewOnly}</p>}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ORDER.map((k) => (
          <div key={k} className="grid gap-1 text-sm"><span aria-hidden>{t.fields[k]}</span>
            <NumberBox label={t.fields[k]} className="rounded-md border border-line px-2 py-1.5 num" value={shown(k)} placeholder={defaults[k]} onValue={(n) => set(k, n)} testId={`va-${k}`} />
            <span className="text-xs text-mute">{t.defaultIs(defaults[k])}</span>
          </div>))}
      </div>
      <section className="mb-6" aria-labelledby="va-adj-h">
        <h2 id="va-adj-h" className="text-lg">{t.adjustmentsTitle}</h2>
        <p className="mb-3 text-sm text-mute">{t.adjustmentsHint}</p>
        <ul className="space-y-2">{adj.map((a, i) => (
          <li key={i} className="flex flex-wrap items-end gap-2" data-testid={`va-adj-${i}`}>
            <select aria-label={`${t.adjN(i + 1)}: ${t.adjustmentsTitle}`} className="rounded-md border border-line px-2 py-1.5 text-sm" value={a.key} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, key: e.target.value as Adjustment["key"] } : x)))}>
              {Object.entries(t.adjKinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <input aria-label={`${t.adjN(i + 1)}: ${t.label}`} className="min-w-40 flex-1 rounded-md border border-line px-2 py-1.5 text-sm" value={a.label} onChange={(e) => setAdj(adj.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <NumberBox label={`${t.adjN(i + 1)}: ${t.amount}`} className="w-40 rounded-md border border-line px-2 py-1.5 text-sm num" value={a.amount} onValue={(n) => setAdj(adj.map((x, j) => (j === i ? { ...x, amount: n ?? 0 } : x)))} />
            <button type="button" className="text-sm text-red underline" aria-label={`${t.remove}: ${t.adjN(i + 1)}`} onClick={() => setAdj(adj.filter((_, j) => j !== i))}>{t.remove}</button>
          </li>))}</ul>
        <button type="button" className="mt-2 text-sm text-brand-d underline" onClick={() => setAdj([...adj, { key: "oneoff", label: t.adjKinds.oneoff, amount: 0 }])} data-testid="va-add-adj">{t.addAdj}</button>
        <p className="mt-2 text-sm">{t.normalised}: <span className="num">{money(v.normalised.ebitda, cur, true)}</span></p>
      </section>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={!canEdit || busy} onClick={onSave} className="rounded-md bg-brand px-4 py-2 text-sm text-white disabled:opacity-50" data-testid="va-save">{busy ? t.saving : t.save}</button>
        <button type="button" onClick={onReset} className="text-sm underline">{t.reset}</button>
        <span aria-live="polite" className={cn("text-sm", msg && !msg.ok && "text-red")} data-testid="va-msg">{msg?.text ?? ""}</span>
      </div>
    </div>
  );
}
