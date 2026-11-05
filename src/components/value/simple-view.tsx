"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/use-t";
import { money } from "@/lib/engine/format";
import { dealMaths, type Valuation, type ValuationInputs } from "@/lib/engine/valuation";
import { plainNumber } from "@/lib/valuation/number";
import { cn } from "@/lib/cn";

const pc = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The valuation in plain words for everyone: the lowest, a fair value and the highest you can ask for, what lowers it
 * and how to raise it, the ways investors and buyers value a business higher, and a deal calculator.
 */
export function SimpleValuation({ v, inputs, cur }: { v: Valuation; inputs: ValuationInputs; cur: string }) {
  const T = useT();
  const t = T.d.val;
  const s = t.simple;
  const fmt = (x: number) => money(x, cur, true);
  // Lowest: the quick-sale value when it is below the fair range, else the fair range's low end.
  const liq = v.methods.find((m) => m.key === "liquidation")?.value?.mid ?? 0;
  const lowFromSale = liq > 0 && liq < v.best.low;
  const lowest = lowFromSale ? liq : v.best.low;
  const band = v.ask.band;
  const highest = band ? Math.max(band.high, v.best.high) : null;
  const tips = v.limits.map((l) => ({ key: l.key, text: s.tips[l.key] })).filter((x) => x.text);
  const period = T.lang === "ar" ? t.window(Math.round(inputs.covered * 10) / 10, T.ml(inputs.end)) : v.label;

  return (
    <div data-testid="value-simple">
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card testId="simple-lowest" label={s.lowest} value={fmt(lowest)} why={lowFromSale ? s.lowestWhy : s.lowestRange} />
        <Card testId="simple-fair" label={s.fair} value={<span data-testid="value-best">{fmt(v.best.mid)}</span>} strong
          why={<>{t.range(fmt(v.best.low), fmt(v.best.high))}. {s.fairWhy(period)}</>} />
        <Card testId="simple-highest" label={s.highest} value={highest != null ? fmt(highest) : "–"} why={highest != null ? s.highestWhy : s.noAsk} />
      </div>
      {v.bestBeforeDiscount.mid > v.best.mid && (
        <p className="mb-6 rounded-md bg-band p-3 text-sm" data-testid="simple-discount">{s.discount(fmt(v.best.mid), fmt(v.bestBeforeDiscount.mid))}</p>
      )}
      {v.usd && <p className="mb-6 text-sm text-mute">{t.usd(money(v.usd.low, "USD", true), money(v.usd.high, "USD", true))}</p>}

      <section className="mb-8 rounded-lg border border-line p-4" aria-labelledby="simple-raise-h" data-testid="simple-raise">
        <h2 id="simple-raise-h" className="mb-3 text-lg">{s.lowers} · {s.raise}</h2>
        {tips.length ? <ul className="list-disc space-y-1.5 ps-5 text-sm">{tips.slice(0, 6).map((x) => <li key={x.key} data-testid={`tip-${x.key}`}>{x.text}</li>)}</ul>
          : <p className="text-sm text-mute">{s.none}</p>}
      </section>

      <section className="mb-8" aria-labelledby="simple-ask-h" data-testid="value-ask">
        <h2 id="simple-ask-h" className="text-lg">{s.askTitle}</h2>
        <p className="mb-4 max-w-3xl text-sm text-mute">{s.askSub}</p>
        <div className="grid gap-4 md:grid-cols-2">
          {v.ask.methods.map((m) => {
            const [name, how, believe] = s.ask[m.key];
            const b = m.key === "pitch" ? ((m.n?.growth ?? 0) > 0 ? believe(pc(m.n!.growth), "") : s.pitchFlat)
              : m.key === "strategic" ? believe(fmt(m.n?.synergy ?? 0), pc(m.n?.share ?? 0.5))
              : m.key === "future" ? (m.n?.basis === 1 ? believe(fmt(m.n.exitProfit), String(m.n.years)) : s.futureSales(fmt(m.n?.exitRevenue ?? 0), String(m.n?.years ?? 5)))
              : believe("", "");
            return (
              <article key={m.key} className="rounded-lg border border-line p-4" data-testid={`ask-${m.key}`}>
                <h3 className="font-medium">{name}</h3>
                {m.value ? <p className="my-1 text-xl num">{fmt(m.value.mid)} <span className="text-sm text-mute">({t.range(fmt(m.value.low), fmt(m.value.high))})</span></p>
                  : <p className="my-1 text-sm text-mute">{s.askReasons[m.reason ?? ""] ?? ""}</p>}
                <p className="text-sm">{how}</p>
                {m.value && <p className="mt-1 text-sm text-mute">{b}</p>}
              </article>
            );
          })}
        </div>
      </section>

      <Deal v={v} inputs={inputs} cur={cur} />

      <section className="mb-8" aria-labelledby="simple-methods-h" data-testid="simple-methods">
        <h2 id="simple-methods-h" className="mb-3 text-lg">{t.methodsTitle}</h2>
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {v.methods.filter((m) => m.key !== "bookAssets").map((m) => {
            const [label, meaning] = s.methods[m.key];
            return (
              <li key={m.key} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
                <details className="min-w-0 flex-1"><summary className="cursor-pointer">{label} <span className="text-xs text-mute" aria-hidden>ⓘ</span><span className="sr-only">: {s.info}</span></summary>
                  <p className="mt-1 text-mute">{meaning}</p></details>
                <span className="num">{m.value ? fmt(m.value.mid) : <span className="text-mute">–</span>}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function Card({ label, value, why, strong, testId }: { label: string; value: React.ReactNode; why: React.ReactNode; strong?: boolean; testId: string }) {
  return (
    <div className={cn("rounded-lg border p-4", strong ? "border-brand bg-brand/5" : "border-line")} data-testid={testId}>
      <p className="text-sm text-mute">{label}</p>
      <p className={cn("my-1 num", strong ? "text-3xl font-semibold" : "text-2xl")}>{value}</p>
      <p className="text-sm">{why}</p>
    </div>
  );
}

/** Ask EGP X for Y%: the value it implies, the multiples of sales and profit, and whether it can be defended. */
function Deal({ v, inputs, cur }: { v: Valuation; inputs: ValuationInputs; cur: string }) {
  const T = useT();
  const s = T.d.val.simple;
  const [amount, setAmount] = useState("");
  const [pct, setPct] = useState("");
  const a = Number(plainNumber(amount)), p = Number(plainNumber(pct.replace(/[%٪]/g, ""))) / 100;
  const d = amount && pct ? dealMaths({ amount: a, pct: p }) : null;
  const top = Math.max(v.best.high, v.ask.band?.high ?? 0);
  // The investor's money goes into the company, so the value it puts on today's company is before that money.
  const pre = d?.preMoney ?? 0;
  const fit = !d ? null : pre < v.best.low ? "low" : pre <= v.best.high ? "fair" : pre <= top ? "ask" : "hard";
  const profit = v.normalised.ebitda;
  const ev = pre + v.ask.netDebt;
  return (
    <section className="mb-8 rounded-lg border border-line p-4" aria-labelledby="deal-h" data-testid="value-deal">
      <h2 id="deal-h" className="text-lg">{s.deal}</h2>
      <p className="mb-3 text-sm text-mute">{s.dealHint}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="grid gap-1">{s.dealAsk}<input inputMode="decimal" className="rounded-md border border-line px-2 py-1.5 num" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="deal-amount" /></label>
        <label className="grid gap-1">{s.dealPct}<input inputMode="decimal" className="w-28 rounded-md border border-line px-2 py-1.5 num" value={pct} onChange={(e) => setPct(e.target.value)} data-testid="deal-pct" /></label>
      </div>
      <div className="mt-3 text-sm" aria-live="polite">
        {d && fit && <div data-testid="deal-result">
          <p className="font-medium">{s.dealValue(money(pre, cur, true), money(d.value, cur, true))}</p>
          {inputs.revenue > 0 && <p className="text-mute">{s.implied((ev / inputs.revenue).toFixed(1), profit > 0 ? (ev / profit).toFixed(1) : "–")}</p>}
          <p className={cn("mt-1", fit === "hard" ? "text-red" : fit === "low" ? "text-ink" : "text-green-d")} data-testid="deal-fit" data-fit={fit}>{s.fit[fit]}</p>
        </div>}
      </div>
    </section>
  );
}
