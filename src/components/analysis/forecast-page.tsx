"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  forecast, FORECAST_HORIZONS, METHOD_ABOUT, METHOD_ABOUT_AR, METHOD_LABEL, METHOD_LABEL_AR, money, pct, plCalc, bsCalc,
  type ForecastDrivers, type ForecastMonth, type Horizon, type ResolvedDrivers,
  hasPL,
} from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { saveForecast } from "@/app/company/[id]/settings/actions";
import { PageHeader } from "@/components/shell/page-header";
import { SentenceSelect } from "@/components/ui/sentence-select";
import { LineChart } from "@/components/charts/line-chart";
import { cn } from "@/lib/cn";
import { EmptyState, Legend, Tile } from "./common";
import { ReadinessCard } from "@/components/setup/readiness-view";
import { useT } from "@/lib/i18n/use-t";
import type { Dict } from "@/lib/i18n";

type FcWords = Dict["plan"]["fc"];
/** A sentence as [text, bold, text, bold, text…]: odd parts are shown in bold. */
const bold = (parts: string[]) => parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));

type DriverKey = Exclude<keyof ForecastDrivers, "horizon" | "loanMonth">;
const DRIVERS: { key: DriverKey; unit: "%" | "days" | "amount"; step: string }[] = [
  { key: "revenueGrowth", unit: "%", step: "0.5" },
  { key: "grossMargin", unit: "%", step: "0.5" },
  { key: "costInflation", unit: "%", step: "0.5" },
  { key: "dso", unit: "days", step: "1" },
  { key: "dio", unit: "days", step: "1" },
  { key: "dpo", unit: "days", step: "1" },
  { key: "capex", unit: "amount", step: "1000" },
  { key: "repayment", unit: "amount", step: "1000" },
  { key: "rate", unit: "%", step: "0.1" },
  { key: "dividends", unit: "amount", step: "10000" },
  { key: "loanAmount", unit: "amount", step: "10000" },
];

/** The hint under a driver box: what the forecast uses when it is left empty. */
function hint(k: DriverKey, a: ResolvedDrivers, cur: string, t: FcWords): string {
  const base = t.d[k][1];
  if (k === "costInflation") return base.replace("{x}", String(a.costInflation));
  if (k === "dso" || k === "dio" || k === "dpo") return base.replace("{x}", String(Math.round(a[k])));
  if (k === "capex") return base.replace("{x}", money(a.capex, cur, true));
  if (k === "repayment") return base + (a.repayment ? t.repFrom(money(a.repayment, cur, true)) : t.repEmpty);
  if (k === "rate") return base + (a.rate ? t.rateNow(a.rate.toFixed(1)) : t.rateNone);
  return base;
}

export function ForecastPage() {
  const c = useCompany();
  const router = useRouter();
  const cur = c.settings.currency;
  const [d, setD] = useState<ForecastDrivers>(c.forecast ?? {});
  const [tab, setTab] = useState<"pl" | "cf" | "bs">("pl");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { lang, d: { plan: { fc: t } }, ml, ms } = useT();
  const f = useMemo(() => forecast(c.months, c.settings, d, c.assumptions ?? {}, c.asOf, lang), [c.months, c.settings, d, c.assumptions, c.asOf, lang]);
  const LABEL = lang === "ar" ? METHOD_LABEL_AR : METHOD_LABEL;
  const canSave = !c.readOnly && c.source !== "demo";
  const saved = c.forecast ?? {};
  const dirty = JSON.stringify(clean(d)) !== JSON.stringify(clean(saved));
  const set = (k: keyof ForecastDrivers, v: unknown) => { setD({ ...d, [k]: v }); setMsg(null); };
  const save = () => start(async () => {
    const r = await saveForecast(c.id, clean(d) as Parameters<typeof saveForecast>[1]);
    setMsg(r.ok ? { ok: true, text: t.saved } : { ok: false, text: r.error ?? t.couldNot });
    if (r.ok) router.refresh();
  });

  const horizonPicker = (
    <div className="sent text-[15px]" data-testid="fc-horizon">
      {t.theNext}{" "}
      <SentenceSelect testId="fc-horizon-select" value={String(f.ok ? f.used.horizon : d.horizon ?? 12)} onChange={(v) => set("horizon", Number(v) as Horizon)}
        options={FORECAST_HORIZONS.map((h) => ({ value: String(h), label: t.months(h) }))} />
    </div>
  );
  if (!f.ok) return (<><PageHeader title={t.title} right={horizonPicker} /><ReadinessCard sector="forecast" /><EmptyState title={t.notEnough} text={f.reason} /></>);

  const s = f.summary;
  // Actual months up to the month the forecast starts from (months holding a P&L; a part month the forecast skips is left out).
  const hist = [...c.months].filter((m) => hasPL(m) && m.period < f.months[0].period).sort((a, b) => a.period.localeCompare(b.period)).slice(-24);
  const labels = [...hist.map((m) => m.period), ...f.months.map((m) => m.period)];
  const H = hist.length;
  const histRev = hist.map((m) => plCalc(m.pl).revenue), histCash = hist.map((m) => bsCalc(m.bs).cash);
  // The forecast line starts at the last actual month so the two join.
  const joined = (actual: number[], fc: number[]) => [...actual.slice(0, -1).map(() => null), actual[H - 1], ...fc];
  const bt = f.backtest;
  return (
    <>
      <PageHeader title={t.title} right={horizonPicker}>
        <p className="text-sm text-mute" data-testid="fc-basis">
          {t.basis(ml(f.start), ml(f.end)).map((p, i) => (i % 2 ? <b key={i} className="text-ink">{p}</b> : p))}<b className="text-ink">{LABEL[f.method]}</b>.
        </p>
      </PageHeader>
      <ReadinessCard sector="forecast" />

      <div className="mb-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label={t.rev12} value={money(s.revenue12, cur, true)} testId="tile-fc-revenue"
          sub={<span className="text-mute">{s.growth12 === null ? t.noYear : t.onLast(`${s.growth12 >= 0 ? "+" : ""}${pct(s.growth12, 1)}`)}</span>} />
        <Tile label={t.profit12} value={money(s.netIncome12, cur, true)} neg={s.netIncome12 < 0} testId="tile-fc-profit"
          sub={<span className="text-mute">{s.netIncomeLast12 === null ? "" : t.last12(money(s.netIncomeLast12, cur, true))}</span>} />
        <Tile label={t.lowCash} value={money(s.lowCash, cur, true)} neg={s.lowCash < 0} testId="tile-fc-lowcash" sub={<span className="text-mute">{t.inMonth(ml(s.lowCashMonth))}</span>} />
        <Tile label={t.cashAt(ms(f.end))} value={money(s.closingCash, cur, true)} neg={s.closingCash < 0} testId="tile-fc-closing" />
      </div>

      <div className={cn("mb-8 flex items-start gap-3 rounded-md px-4 py-3 text-[13.5px]", s.cashNegativeFrom ? "bg-red-bg text-red" : "bg-brand-bg text-ink")} data-testid="fc-cash-verdict">
        {s.cashNegativeFrom ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-d" />}
        <p>{s.cashNegativeFrom
          ? bold(t.runsOut(ml(s.cashNegativeFrom), money(s.fundingNeed, cur), ml(s.lowCashMonth)))
          : bold(t.staysPositive(money(s.lowCash, cur), ml(s.lowCashMonth)))}</p>
      </div>

      <div className="mb-10 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 text-lg font-normal">{t.revenue}</h2>
          <Legend items={[{ label: t.actual, color: "#0B6E70" }, { label: t.forecast, color: "#0B6E70", dashed: true }, { label: t.range, color: "#9CC9C9", dashed: true }]} />
          <LineChart labels={labels.map(ms)} cur={cur} height={260} testId="fc-revenue-chart" legend={false} series={[
            { name: t.actual, values: [...histRev, ...f.months.map(() => null)], color: "#0B6E70" },
            { name: t.forecast, values: joined(histRev, f.months.map((m) => m.P.revenue)), color: "#0B6E70", dashed: true, dots: false },
            { name: t.rangeLow, values: joined(histRev, f.months.map((m) => m.revenueLow)), color: "#9CC9C9", dashed: true, dots: false },
            { name: t.rangeHigh, values: joined(histRev, f.months.map((m) => m.revenueHigh)), color: "#9CC9C9", dashed: true, dots: false },
          ]} />
        </section>
        <section>
          <h2 className="mb-1 text-lg font-normal">{t.cash}</h2>
          <Legend items={[{ label: t.actual, color: "#2E9E6A" }, { label: t.forecast, color: "#2E9E6A", dashed: true }]} />
          <LineChart labels={labels.map(ms)} cur={cur} height={260} testId="fc-cash-chart" legend={false} series={[
            { name: t.actual, values: [...histCash, ...f.months.map(() => null)], color: "#2E9E6A" },
            { name: t.forecast, values: joined(histCash, f.months.map((m) => m.B.cash)), color: "#2E9E6A", dashed: true, dots: false },
          ]} />
        </section>
      </div>

      <section className="mb-10 rounded-lg border border-line p-4" data-testid="fc-accuracy">
        <h2 className="mb-1 text-lg font-normal">{t.accuracy}</h2>
        {bt ? (
          <>
            <p className="mb-3 text-[13.5px]">
              {bold(t.hid(bt.months, pct(bt.revenueMape, 1), pct(bt.ebitError, 1)))}{bt.revenueMape <= 5 ? t.close : bt.revenueMape <= 15 ? t.fair : t.loose}
            </p>
            <div className="grid gap-6 md:grid-cols-2">
              <table className="tbl text-[13px]">
                <thead><tr><th>{t.method}</th><th>{t.avgError}</th></tr></thead>
                <tbody>{bt.tried.map((m) => (
                  <tr key={m.method} className={cn("row", m.method === f.method && "font-medium")}><td>{LABEL[m.method]}{m.method === f.method ? t.used : ""}</td><td>{pct(m.revenueMape, 1)}</td></tr>
                ))}</tbody>
              </table>
              <table className="tbl text-[13px]">
                <thead><tr><th>{t.hidden}</th><th>{t.actual}</th><th>{t.forecast}</th></tr></thead>
                <tbody>{bt.detail.map((x) => <tr key={x.period} className="row"><td>{ml(x.period)}</td><td>{money(x.actual, cur, true)}</td><td>{money(x.forecast, cur, true)}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-mute">{LABEL[f.method]}: {(lang === "ar" ? METHOD_ABOUT_AR : METHOD_ABOUT)[f.method]}</p>
          </>
        ) : <p className="text-[13.5px] text-mute">{t.tooFew}</p>}
      </section>

      <section className="mb-10 rounded-lg border border-line p-4" data-testid="fc-drivers">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-normal">{t.drivers}</h2>
          <span className="text-xs text-mute">{t.emptyUse}</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DRIVERS.map((x) => (
            <label key={x.key} className="block">
              <span className="label mb-1 block">{t.d[x.key][0]}</span>
              <span className="flex items-center gap-2">
                <input type="number" inputMode="decimal" step={x.step} value={(d[x.key] as number | null | undefined) ?? ""} data-testid={`fc-${x.key}`}
                  placeholder={placeholder(x.key, f.auto, t.auto)}
                  onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); set(x.key, Number.isFinite(v) ? v : null); }}
                  className="w-full rounded border border-line px-3 py-2 text-end outline-none placeholder:text-[#b5b5ae] focus:border-brand" />
                <span className="w-14 shrink-0 text-xs text-mute">{x.unit === "amount" ? cur : x.unit === "days" ? t.days : x.unit}</span>
              </span>
              <span className="mt-1 block text-xs text-mute">{hint(x.key, f.auto, cur, t)}</span>
            </label>
          ))}
          <label className="block">
            <span className="label mb-1 block">{t.loanMonth}</span>
            <select value={d.loanMonth ?? ""} onChange={(e) => set("loanMonth", e.target.value || null)} className="w-full rounded border border-line px-3 py-2" data-testid="fc-loanMonth">
              <option value="">{t.choose}</option>
              {f.months.map((m) => <option key={m.period} value={m.period}>{ml(m.period)}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {msg && <span className={cn("me-auto text-sm", msg.ok ? "text-green-d" : "text-red")} role="status">{msg.text}</span>}
          <button type="button" onClick={() => { setD({ horizon: d.horizon }); setMsg(null); }} className="rounded px-4 py-2 text-sm text-mute hover:bg-band" data-testid="fc-reset">{t.useHistory}</button>
          {canSave ? (
            <button type="button" onClick={save} disabled={!dirty || pending} className="rounded bg-brand-d px-5 py-2 font-medium text-white disabled:opacity-50" data-testid="save-forecast">{pending ? t.saving : t.save}</button>
          ) : <span className="text-xs text-mute">{c.source === "demo" ? t.demo : t.viewOnly}</span>}
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex gap-1 rounded-md bg-band p-1 text-sm sm:w-fit">
          {(["pl", "cf", "bs"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={cn("flex-1 whitespace-nowrap rounded px-3 py-1", tab === k ? "bg-white font-semibold shadow-sm" : "text-mute")} data-testid={`fc-tab-${k}`}>{t.tabs[k]}</button>
          ))}
        </div>
        <div className="overflow-x-auto"><ForecastTable months={f.months} tab={tab} cur={cur} t={t} /></div>
      </section>

      {f.notes.length > 0 && (
        <ul className="mb-6 list-disc space-y-1 ps-5 text-[13px] text-mute" data-testid="fc-notes">{f.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
      <details className="mb-6 text-[13px]">
        <summary className="cursor-pointer font-medium">{t.how}</summary>
        <div className="mt-2 space-y-1.5 text-mute">
          {t.howText.map((p) => <p key={p}>{p}</p>)}
        </div>
      </details>
    </>
  );
}

function clean(d: ForecastDrivers): ForecastDrivers {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== "")) as ForecastDrivers;
}

function placeholder(k: DriverKey, a: ResolvedDrivers, auto: string): string {
  const v = a[k];
  if (v === null || v === undefined) return auto;
  if (k === "dso" || k === "dio" || k === "dpo") return String(Math.round(v as number));
  if (k === "rate" || k === "costInflation") return (v as number).toFixed(1);
  return v ? String(Math.round(v as number)) : "0";
}

const PL_LINES: [string, (m: ForecastMonth) => number, boolean?][] = [
  ["Revenue", (m) => m.P.revenue], ["Cost of Sales", (m) => m.P.cos], ["Gross Profit", (m) => m.P.gross_profit, true],
  ["Expenses", (m) => m.P.expenses], ["Other Income less Expenses", (m) => m.P.other_income - m.P.other_expenses], ["EBIT", (m) => m.P.ebit, true],
  ["Net Interest", (m) => m.P.net_interest], ["Tax", (m) => m.P.tax_expenses], ["Net Profit", (m) => m.P.net_income, true],
];
const CF_LINES: [string, (m: ForecastMonth) => number, boolean?][] = [
  ["Operating Cash Flow", (m) => m.W.ocf, true], ["Investment in Assets", (m) => m.W.fcf - m.W.ocf], ["Free Cash Flow", (m) => m.W.fcf, true],
  ["Interest, Loans and Dividends", (m) => m.W.ncf + m.W.ddebt - m.W.fcf], ["Closing Cash", (m) => m.B.cash, true],
];
const BS_LINES: [string, (m: ForecastMonth) => number, boolean?][] = [
  ["Cash", (m) => m.B.cash], ["Accounts Receivable", (m) => m.B.ar], ["Inventory", (m) => m.B.inventory], ["Fixed Assets", (m) => m.B.fixed_assets], ["Total Assets", (m) => m.B.ta, true],
  ["Accounts Payable", (m) => m.B.ap], ["Borrowing", (m) => m.B.debt], ["Total Liabilities", (m) => m.B.tl, true], ["Equity", (m) => m.B.te, true],
];

function ForecastTable({ months, tab, cur, t }: { months: ForecastMonth[]; tab: "pl" | "cf" | "bs"; cur: string; t: FcWords }) {
  const { tl, ms } = useT();
  const name = (s: string) => t.lines[s] ?? tl(s);
  const lines = tab === "pl" ? PL_LINES : tab === "cf" ? CF_LINES : BS_LINES;
  const total = tab !== "bs";
  const year = months.slice(0, 12);
  return (
    <table className="tbl text-[12.5px]" data-testid="fc-table">
      <thead><tr><th>{tab === "bs" ? t.monthEnd : t.month}</th>{months.map((m) => <th key={m.period}>{ms(m.period)}</th>)}{total && <th>{t.next12}</th>}</tr></thead>
      <tbody>{lines.map(([label, f, tot]) => (
        <tr key={label} className={cn("row", tot && "font-semibold")}>
          <td>{name(label)}</td>
          {months.map((m) => { const v = f(m); return <td key={m.period} className={v < 0 ? "text-red" : ""}>{money(v, cur, true)}</td>; })}
          {total && <td>{label === "Closing Cash" ? money(year[year.length - 1].B.cash, cur, true) : money(year.reduce((s, m) => s + f(m), 0), cur, true)}</td>}
        </tr>
      ))}</tbody>
    </table>
  );
}

