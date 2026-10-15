"use client";
import Link from "next/link";
import { useMemo } from "react";
import { Boxes, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { hasPL, money } from "@/lib/engine";
import { inventoryAnalysis, inventoryLedger, type InventoryBridge } from "@/lib/engine/inventory";
import type { TieOut } from "@/lib/engine/tieout";
import { useCompany } from "@/lib/company/context";
import { useExpenses } from "@/lib/company/expenses-context";
import { useInventory } from "@/lib/company/inventory-context";
import { usePeriod } from "@/lib/company/use-period";
import { PeriodPicker } from "@/components/shell/period-picker";
import { useLang } from "@/lib/i18n/context";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";

export { DataNotes, Findings, SalesTile as Tile } from "@/components/sales/common";

/**
 * The Inventory analysis for the period in the URL. The ledger side of the tie-outs comes from the accounts already loaded:
 * the balance-sheet stock per month and the cost of goods sold posted by stock moves (expense lines).
 */
export function useInventoryAnalysis() {
  const c = useCompany();
  const d = useInventory();
  const expenses = useExpenses();
  const { sel } = usePeriod();
  const lang = useLang();
  return useMemo(() => {
    const months = [...new Set([...d.layers.map((l) => l.p), ...d.moves.map((m) => m.p)])].sort();
    if (!months.length) return null;
    // The selected month when Inventory holds it; otherwise the latest month with stock records.
    const end = sel.end && months.includes(sel.end) ? sel.end : months[months.length - 1];
    const revenue = Object.fromEntries(c.months.filter(hasPL).map((m) => [m.period, m.pl.revenue ?? 0]));
    const s = inventoryAnalysis(d, { type: sel.type, end }, c.settings.fyStartMonth, { ledger: inventoryLedger(c.months, expenses), revenue, lang, cur: c.settings.currency });
    return { ...s, end, months, own: end === sel.end };
  }, [d, expenses, sel.type, sel.end, c.months, c.settings.fyStartMonth, c.settings.currency, lang]);
}
export type InventoryView = NonNullable<ReturnType<typeof useInventoryAnalysis>>;

/** The period picker; when the picked month has no stock records, says which month is shown instead. */
export function InventoryPicker({ s }: { s: InventoryView }) {
  const c = useCompany();
  const T = useT();
  const t = T.d.inv;
  if (c.months.length && s.own) return <PeriodPicker />;
  return <span className="text-[15px]" data-testid="inventory-period">{t.stockFor} <b>{s.label}</b> <span className="text-xs text-mute">({t.latest})</span></span>;
}

export function NoInventory() {
  const c = useCompany();
  const t = useT().d.inv;
  return (
    <div className="mx-auto max-w-xl py-16 text-center" data-testid="no-inventory">
      <Boxes className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      <h2 className="text-2xl font-light">{t.noStock}</h2>
      <p className="mt-2 text-mute">{t.noStockText}</p>
      {!c.readOnly && <Link href={`${c.basePath}/settings/source-data?step=inventory`} className="mt-6 inline-block rounded bg-brand-d px-5 py-2.5 font-medium text-white">{t.upload}</Link>}
    </div>
  );
}

/** One line on the tie-outs of the period: all agree, some differ (with the months), or no ledger to check against. */
export function TieBanner({ s, link }: { s: InventoryView; link?: string }) {
  const T = useT();
  const t = T.d.inv;
  const off = s.tieouts.filter((x) => x.status === "off");
  const ok = s.tieouts.filter((x) => x.status === "ok");
  const more = link ? <Link href={link} className="ms-2 underline">{t.seeChecks}</Link> : null;
  return (
    <div className="mb-8 space-y-2" data-testid="inv-tieouts">
      {off.length > 0 ? (
        <div className="rounded bg-red-bg px-4 py-2.5 text-[13px] text-red">
          <div className="flex items-start gap-2 font-medium"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{t.someOff(off.length)}{more}</div>
          <ul className="ms-6 mt-1 list-disc">{off.slice(0, 6).map((x) => <li key={`${x.key}${x.period}`}>{T.ml(x.period)}: {t.checks[x.key]}</li>)}</ul>
        </div>
      ) : ok.length > 0 ? (
        <p className="flex items-start gap-2 rounded bg-green-bg px-4 py-2.5 text-[13px] text-green-d"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{t.allAgree(ok.length)}{more}</p>
      ) : (
        <p className="flex items-start gap-2 rounded bg-band px-4 py-2.5 text-[13px] text-mute"><Info className="mt-0.5 h-4 w-4 shrink-0" />{t.noLedger}</p>
      )}
      {s.partialValuation && <p className="flex items-start gap-2 rounded bg-amber/10 px-4 py-2.5 text-[13px]"><Info className="mt-0.5 h-4 w-4 shrink-0 text-amber" />{t.partial}</p>}
    </div>
  );
}

export function TieChip({ status }: { status: TieOut["status"] }) {
  const t = useT().d.inv;
  return (
    <span data-testid={`tie-${status}`} className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", status === "ok" ? "bg-green-bg text-green-d" : status === "off" ? "bg-red-bg text-red" : "bg-band text-mute")}>
      {status === "ok" ? t.ok : status === "off" ? t.off : t.noLedgerChip}
    </span>
  );
}

/** Every tie-out of the period: month, check, Inventory's figure, the accounts', the difference, and the documents behind a difference. */
export function TieTable({ tieouts, cur }: { tieouts: TieOut[]; cur: string }) {
  const T = useT();
  const t = T.d.inv;
  const f = (x: TieOut, v: number | null) => (v === null ? "–" : x.key === "qty_onhand" ? v.toLocaleString("en-US") : money(v, cur));
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="tbl min-w-[720px]" data-testid="inv-tieout-table">
        <thead><tr><th className="!text-start">{t.month}</th><th className="!text-start">{t.check}</th><th>{t.inventory}</th><th>{t.accounts}</th><th>{t.difference}</th><th className="!text-start">{t.status}</th></tr></thead>
        <tbody>
          {[...tieouts].sort((a, b) => a.period.localeCompare(b.period)).map((x) => (
            <tr key={`${x.key}${x.period}`} className="row align-top" data-testid="tie-row">
              <td className="!text-start">{T.ml(x.period)}</td>
              <td className="!text-start">
                {t.checks[x.key]}
                {x.causes.length > 0 && (
                  <details className="mt-1 text-[12px]">
                    <summary className="cursor-pointer text-mute">{t.causes(x.causes.length)}</summary>
                    <ul className="mt-1 space-y-0.5">{x.causes.map((c) => <li key={c.ref}><span className="font-medium">{c.ref}</span>: {f(x, c.module)} / {f(x, c.ledger)} <span className="text-mute">({t.why[c.why]})</span></li>)}</ul>
                  </details>
                )}
              </td>
              <td className="num">{f(x, x.module)}</td>
              <td className="num">{f(x, x.ledger)}</td>
              <td className={cn("num", x.status === "off" && "text-red")}>{f(x, x.diff)}</td>
              <td className="!text-start"><TieChip status={x.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** From opening to closing stock value: what each kind of layer added (green) or took out (red). Adds up exactly. */
export function StockBridge({ b, cur, testId = "inv-bridge" }: { b: InventoryBridge; cur: string; testId?: string }) {
  const t = useT().d.inv;
  const parts: [string, number][] = [[t.receipts, b.receipts], [t.landed, b.landed], [t.deliveries, b.deliveries], [t.returns, b.returns], [t.adjustments, b.adjustments], [t.revaluation, b.revaluation]];
  const steps: { label: string; from: number; to: number; kind: "total" | "up" | "down" }[] = [{ label: t.opening, from: 0, to: b.opening, kind: "total" }];
  let run = b.opening;
  for (const [label, v] of parts) { if (!v) continue; steps.push({ label, from: run, to: run + v, kind: v > 0 ? "up" : "down" }); run += v; }
  steps.push({ label: t.closing, from: 0, to: b.closing, kind: "total" });
  const ends = steps.flatMap((x) => [x.from, x.to]);
  const hi = Math.max(...ends, 0), lo = Math.min(...ends, 0);
  const X = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  return (
    <div dir="ltr" className="text-[12.5px]" data-testid={testId}>
      {steps.map((x, i) => {
        const a = X(Math.min(x.from, x.to)), z = X(Math.max(x.from, x.to));
        const delta = x.to - x.from;
        return (
          <div key={i} className={cn("grid grid-cols-[minmax(110px,42%)_1fr] items-center gap-3", x.kind === "total" && i > 0 && "border-t border-ink pt-1 font-semibold")}>
            <div className="truncate py-[5px]" title={x.label}>{x.label}</div>
            <div className="relative h-5">
              <div className="absolute inset-y-[3px] rounded-[2px]" style={{ left: `${a}%`, width: `max(${z - a}%, 2px)`, background: x.kind === "total" ? "#5b5b55" : x.kind === "up" ? "#2E9E6A" : "#D9343A" }} />
              <span className={cn("num absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px]", x.kind === "up" ? "text-green-d" : x.kind === "down" ? "text-red" : "")} style={z < 70 ? { left: `calc(${z}% + 6px)` } : { right: `calc(${100 - a}% + 6px)` }}>
                {x.kind === "total" ? money(x.to, cur) : `${delta > 0 ? "+" : "−"}${money(Math.abs(delta), cur)}`}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
