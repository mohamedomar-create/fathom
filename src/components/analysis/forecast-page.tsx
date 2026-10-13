"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  forecast, FORECAST_HORIZONS, METHOD_ABOUT, METHOD_LABEL, mlabel, money, mshort, pct, plCalc, bsCalc,
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

type DriverKey = Exclude<keyof ForecastDrivers, "horizon" | "loanMonth">;
const DRIVERS: { key: DriverKey; label: string; unit: "%" | "days" | "amount"; hint: (auto: ResolvedDrivers, cur: string) => string; step: string }[] = [
  { key: "revenueGrowth", label: "Revenue growth", unit: "%", step: "0.5", hint: () => "% a year. Empty: the tested method sets the path." },
  { key: "grossMargin", label: "Gross margin", unit: "%", step: "0.5", hint: () => "Empty: cost of sales follows revenue at your recent ratio." },
  { key: "costInflation", label: "Rise in fixed costs", unit: "%", step: "0.5", hint: (a) => `% a year. From your inflation assumption: ${a.costInflation}%.` },
  { key: "dso", label: "Customer days", unit: "days", step: "1", hint: (a) => `Last 3 months: ${Math.round(a.dso)} days.` },
  { key: "dio", label: "Stock days", unit: "days", step: "1", hint: (a) => `Last 3 months: ${Math.round(a.dio)} days.` },
  { key: "dpo", label: "Supplier days", unit: "days", step: "1", hint: (a) => `Last 3 months: ${Math.round(a.dpo)} days.` },
  { key: "capex", label: "Investment in assets", unit: "amount", step: "1000", hint: (a, cur) => `Per month. Last 12 months: ${money(a.capex, cur, true)}.` },
  { key: "repayment", label: "Loan repayments", unit: "amount", step: "1000", hint: (a, cur) => `Principal per month. ${a.repayment ? `From your bank figures: ${money(a.repayment, cur, true)}.` : "Empty: long-term loans held at today's balance."}` },
  { key: "rate", label: "Borrowing rate", unit: "%", step: "0.1", hint: (a) => `% a year. ${a.rate ? `Now: ${a.rate.toFixed(1)}%.` : "No borrowing cost recorded."}` },
  { key: "dividends", label: "Dividends", unit: "amount", step: "10000", hint: () => "Per year, paid evenly." },
  { key: "loanAmount", label: "New loan", unit: "amount", step: "10000", hint: () => "Long-term borrowing drawn in the month chosen below." },
];

export function ForecastPage() {
  const c = useCompany();
  const router = useRouter();
  const cur = c.settings.currency;
  const [d, setD] = useState<ForecastDrivers>(c.forecast ?? {});
  const [tab, setTab] = useState<"pl" | "cf" | "bs">("pl");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const f = useMemo(() => forecast(c.months, c.settings, d, c.assumptions ?? {}, c.asOf), [c.months, c.settings, d, c.assumptions, c.asOf]);
  const canSave = !c.readOnly && c.source !== "demo";
  const saved = c.forecast ?? {};
  const dirty = JSON.stringify(clean(d)) !== JSON.stringify(clean(saved));
  const set = (k: keyof ForecastDrivers, v: unknown) => { setD({ ...d, [k]: v }); setMsg(null); };
  const save = () => start(async () => {
    const r = await saveForecast(c.id, clean(d) as Parameters<typeof saveForecast>[1]);
    setMsg(r.ok ? { ok: true, text: "Saved for this company." } : { ok: false, text: r.error ?? "Could not save" });
    if (r.ok) router.refresh();
  });

  const horizonPicker = (
    <div className="sent text-[15px]" data-testid="fc-horizon">
      The next{" "}
      <SentenceSelect testId="fc-horizon-select" value={String(f.ok ? f.used.horizon : d.horizon ?? 12)} onChange={(v) => set("horizon", Number(v) as Horizon)}
        options={FORECAST_HORIZONS.map((h) => ({ value: String(h), label: `${h} months` }))} />
    </div>
  );
  if (!f.ok) return (<><PageHeader title="Forecast" right={horizonPicker} /><EmptyState title="Not enough history to forecast" text={f.reason} /></>);

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
      <PageHeader title="Forecast" right={horizonPicker}>
        <p className="text-sm text-mute" data-testid="fc-basis">
          Profit, balance sheet and cash projected together from <b className="text-ink">{mlabel(f.start)}</b> to <b className="text-ink">{mlabel(f.end)}</b>, built from your own figures.
          Revenue method: <b className="text-ink">{METHOD_LABEL[f.method]}</b>.
        </p>
      </PageHeader>

      <div className="mb-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Revenue, next 12 months" value={money(s.revenue12, cur, true)} testId="tile-fc-revenue"
          sub={<span className="text-mute">{s.growth12 === null ? "no full year to compare" : `${s.growth12 >= 0 ? "+" : ""}${pct(s.growth12, 1)} on the last 12 months`}</span>} />
        <Tile label="Net profit, next 12 months" value={money(s.netIncome12, cur, true)} neg={s.netIncome12 < 0} testId="tile-fc-profit"
          sub={<span className="text-mute">{s.netIncomeLast12 === null ? "" : `last 12 months ${money(s.netIncomeLast12, cur, true)}`}</span>} />
        <Tile label="Lowest cash" value={money(s.lowCash, cur, true)} neg={s.lowCash < 0} testId="tile-fc-lowcash" sub={<span className="text-mute">in {mlabel(s.lowCashMonth)}</span>} />
        <Tile label={`Cash at ${mshort(f.end)}`} value={money(s.closingCash, cur, true)} neg={s.closingCash < 0} testId="tile-fc-closing" />
      </div>

      <div className={cn("mb-8 flex items-start gap-3 rounded-md px-4 py-3 text-[13.5px]", s.cashNegativeFrom ? "bg-red-bg text-red" : "bg-brand-bg text-ink")} data-testid="fc-cash-verdict">
        {s.cashNegativeFrom ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-d" />}
        <p>{s.cashNegativeFrom
          ? <>Cash runs out in <b>{mlabel(s.cashNegativeFrom)}</b>. About <b>{money(s.fundingNeed, cur)}</b> more is needed by {mlabel(s.lowCashMonth)} to keep the account above zero: arrange a facility now, collect faster or hold back investment.</>
          : <>Cash stays positive throughout. The lowest point is <b>{money(s.lowCash, cur)}</b> in {mlabel(s.lowCashMonth)}.</>}</p>
      </div>

      <div className="mb-10 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-1 text-lg font-normal">Revenue</h2>
          <Legend items={[{ label: "Actual", color: "#0B6E70" }, { label: "Forecast", color: "#0B6E70", dashed: true }, { label: "Likely range", color: "#9CC9C9", dashed: true }]} />
          <LineChart labels={labels.map(mshort)} cur={cur} height={260} testId="fc-revenue-chart" legend={false} series={[
            { name: "Actual", values: [...histRev, ...f.months.map(() => null)], color: "#0B6E70" },
            { name: "Forecast", values: joined(histRev, f.months.map((m) => m.P.revenue)), color: "#0B6E70", dashed: true, dots: false },
            { name: "Range, low", values: joined(histRev, f.months.map((m) => m.revenueLow)), color: "#9CC9C9", dashed: true, dots: false },
            { name: "Range, high", values: joined(histRev, f.months.map((m) => m.revenueHigh)), color: "#9CC9C9", dashed: true, dots: false },
          ]} />
        </section>
        <section>
          <h2 className="mb-1 text-lg font-normal">Cash on hand</h2>
          <Legend items={[{ label: "Actual", color: "#2E9E6A" }, { label: "Forecast", color: "#2E9E6A", dashed: true }]} />
          <LineChart labels={labels.map(mshort)} cur={cur} height={260} testId="fc-cash-chart" legend={false} series={[
            { name: "Actual", values: [...histCash, ...f.months.map(() => null)], color: "#2E9E6A" },
            { name: "Forecast", values: joined(histCash, f.months.map((m) => m.B.cash)), color: "#2E9E6A", dashed: true, dots: false },
          ]} />
        </section>
      </div>

      <section className="mb-10 rounded-lg border border-line p-4" data-testid="fc-accuracy">
        <h2 className="mb-1 text-lg font-normal">How accurate is this?</h2>
        {bt ? (
          <>
            <p className="mb-3 text-[13.5px]">
              We hid your last <b>{bt.months} months</b>, forecast them from the months before, and compared. Revenue was off by <b>{pct(bt.revenueMape, 1)}</b> a month on average,
              and operating profit (EBIT) by <b>{pct(bt.ebitError, 1)}</b> of revenue. {bt.revenueMape <= 5 ? "That is a close fit." : bt.revenueMape <= 15 ? "A fair fit: treat the monthly figures as a guide and the year total as firmer." : "A loose fit: your revenue moves a lot from month to month, so plan on the range, not the line."}
            </p>
            <div className="grid gap-6 md:grid-cols-2">
              <table className="tbl text-[13px]">
                <thead><tr><th>Method tried</th><th>Average error</th></tr></thead>
                <tbody>{bt.tried.map((t) => (
                  <tr key={t.method} className={cn("row", t.method === f.method && "font-medium")}><td>{METHOD_LABEL[t.method]}{t.method === f.method ? " (used)" : ""}</td><td>{pct(t.revenueMape, 1)}</td></tr>
                ))}</tbody>
              </table>
              <table className="tbl text-[13px]">
                <thead><tr><th>Hidden month</th><th>Actual</th><th>Forecast</th></tr></thead>
                <tbody>{bt.detail.map((x) => <tr key={x.period} className="row"><td>{mlabel(x.period)}</td><td>{money(x.actual, cur, true)}</td><td>{money(x.forecast, cur, true)}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-mute">{METHOD_LABEL[f.method]}: {METHOD_ABOUT[f.method]}</p>
          </>
        ) : <p className="text-[13.5px] text-mute">Too few months to test the forecast against your own history yet; the range shown assumes ±15%.</p>}
      </section>

      <section className="mb-10 rounded-lg border border-line p-4" data-testid="fc-drivers">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-normal">Drivers</h2>
          <span className="text-xs text-mute">Leave a box empty to use the figure from your history.</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DRIVERS.map((x) => (
            <label key={x.key} className="block">
              <span className="label mb-1 block">{x.label}</span>
              <span className="flex items-center gap-2">
                <input type="number" inputMode="decimal" step={x.step} value={(d[x.key] as number | null | undefined) ?? ""} data-testid={`fc-${x.key}`}
                  placeholder={placeholder(x.key, f.auto)}
                  onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); set(x.key, Number.isFinite(v) ? v : null); }}
                  className="w-full rounded border border-line px-3 py-2 text-right outline-none placeholder:text-[#b5b5ae] focus:border-brand" />
                <span className="w-14 shrink-0 text-xs text-mute">{x.unit === "amount" ? cur : x.unit}</span>
              </span>
              <span className="mt-1 block text-xs text-mute">{x.hint(f.auto, cur)}</span>
            </label>
          ))}
          <label className="block">
            <span className="label mb-1 block">Month the loan is drawn</span>
            <select value={d.loanMonth ?? ""} onChange={(e) => set("loanMonth", e.target.value || null)} className="w-full rounded border border-line px-3 py-2" data-testid="fc-loanMonth">
              <option value="">Choose…</option>
              {f.months.map((m) => <option key={m.period} value={m.period}>{mlabel(m.period)}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {msg && <span className={cn("mr-auto text-sm", msg.ok ? "text-green-d" : "text-red")} role="status">{msg.text}</span>}
          <button type="button" onClick={() => { setD({ horizon: d.horizon }); setMsg(null); }} className="rounded px-4 py-2 text-sm text-mute hover:bg-band" data-testid="fc-reset">Use history for all</button>
          {canSave ? (
            <button type="button" onClick={save} disabled={!dirty || pending} className="rounded bg-brand-d px-5 py-2 font-medium text-white disabled:opacity-50" data-testid="save-forecast">{pending ? "Saving…" : "Save drivers"}</button>
          ) : <span className="text-xs text-mute">{c.source === "demo" ? "Try any figure: the demo is not saved." : "View-only: changes are not saved."}</span>}
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex gap-1 rounded-md bg-band p-1 text-sm sm:w-fit">
          {([["pl", "Profit & Loss"], ["cf", "Cash Flow"], ["bs", "Balance Sheet"]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={cn("flex-1 whitespace-nowrap rounded px-3 py-1", tab === k ? "bg-white font-semibold shadow-sm" : "text-mute")} data-testid={`fc-tab-${k}`}>{l}</button>
          ))}
        </div>
        <div className="overflow-x-auto"><ForecastTable months={f.months} tab={tab} cur={cur} /></div>
      </section>

      {f.notes.length > 0 && (
        <ul className="mb-6 list-disc space-y-1 pl-5 text-[13px] text-mute" data-testid="fc-notes">{f.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
      <details className="mb-6 text-[13px]">
        <summary className="cursor-pointer font-medium">How this forecast is built</summary>
        <div className="mt-2 space-y-1.5 text-mute">
          <p>Revenue: each method below is tested by hiding your latest months and forecasting them; the one with the smallest error is used. With 24 months or more a seasonal pattern can be learned.</p>
          <p>Costs: variable cost of sales and variable expenses keep their recent share of revenue (last 12 months). Fixed costs and depreciation start from the last 3 months and rise with the cost driver; new investment adds depreciation over the assets&apos; average life.</p>
          <p>Interest: borrowing × the rate, on the average balance each month. Tax: the company rate on the year&apos;s profit to date, so earlier losses are offset first.</p>
          <p>Balance sheet: customers, stock and suppliers follow the days held; fixed assets move with investment and depreciation; loans with drawings and repayments; equity with profit and dividends. Everything else is held. Cash is what is left, so the balance sheet always balances and the cash flow reconciles.</p>
        </div>
      </details>
    </>
  );
}

function clean(d: ForecastDrivers): ForecastDrivers {
  return Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== "")) as ForecastDrivers;
}

function placeholder(k: DriverKey, a: ResolvedDrivers): string {
  const v = a[k];
  if (v === null || v === undefined) return "auto";
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

function ForecastTable({ months, tab, cur }: { months: ForecastMonth[]; tab: "pl" | "cf" | "bs"; cur: string }) {
  const lines = tab === "pl" ? PL_LINES : tab === "cf" ? CF_LINES : BS_LINES;
  const total = tab !== "bs";
  const year = months.slice(0, 12);
  return (
    <table className="tbl text-[12.5px]" data-testid="fc-table">
      <thead><tr><th>{tab === "bs" ? "Month-end" : "Month"}</th>{months.map((m) => <th key={m.period}>{mshort(m.period)}</th>)}{total && <th>Next 12 months</th>}</tr></thead>
      <tbody>{lines.map(([label, f, tot]) => (
        <tr key={label} className={cn("row", tot && "font-semibold")}>
          <td>{label}</td>
          {months.map((m) => { const v = f(m); return <td key={m.period} className={v < 0 ? "text-red" : ""}>{money(v, cur, true)}</td>; })}
          {total && <td>{label === "Closing Cash" ? money(year[year.length - 1].B.cash, cur, true) : money(year.reduce((s, m) => s + f(m), 0), cur, true)}</td>}
        </tr>
      ))}</tbody>
    </table>
  );
}

