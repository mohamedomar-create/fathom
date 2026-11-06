"use client";
// Data health: every cross-check between modules and the books, with each month's figures. The books are the master; a
// difference is listed, never adjusted.
import { money } from "@/lib/engine/format";
import { useCompany } from "@/lib/company/context";
import type { CrossCheck } from "@/lib/crosscheck";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";

export function CrossChecks({ checks }: { checks: CrossCheck[] }) {
  const c = useCompany();
  const { d, lang, ml } = useT();
  const t = d.ink.page;
  const cur = c.settings.currency;
  return (
    <section className="mt-10" data-testid="cross-checks">
      <h2 className="t-card mb-1">{t.crossTitle}</h2>
      <p className="mb-3 text-sm text-mute">{t.crossSub}</p>
      {!checks.length ? <p className="text-sm text-mute">{t.crossNone}</p> : checks.map((x) => (
        <div key={x.key} className="mb-4 rounded-lg border border-line" data-testid={`cross-${x.key}`} data-status={x.status}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
            <b className="font-medium">{lang === "ar" ? x.label.ar : x.label.en}</b>
            <span className={cn("text-sm", x.status === "differs" ? "text-red" : x.status === "agrees" ? "text-green-d" : "text-mute")}>
              {x.status === "agrees" ? t.agreeOk(x.months.length) : x.status === "differs" && x.worst ? t.agreeOff(money(x.worst.diff ?? 0, cur), ml(x.worst.period)) : x.reason === "no_overlap" ? t.noOverlap : t.notChecked}
            </span>
          </div>
          {x.months.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-band"><tr>{[t.month, t.module, t.books, t.diff].map((h) => <th key={h} className="px-3 py-1.5 text-start font-medium">{h}</th>)}</tr></thead>
                <tbody>{x.months.slice(-12).map((m) => (
                  <tr key={m.period} className="border-t border-line">
                    <td className="px-3 py-1">{ml(m.period)}</td><td className="num px-3 py-1">{money(m.module, cur)}</td>
                    <td className="num px-3 py-1">{money(m.ledger, cur)}</td>
                    <td className={cn("num px-3 py-1", m.status === "off" && "text-red")}>{m.status === "off" ? money(m.diff, cur) : "✓"}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
