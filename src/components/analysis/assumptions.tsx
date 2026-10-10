"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Assumptions } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { saveAssumptions } from "@/app/company/[id]/settings/actions";
import { cn } from "@/lib/cn";

export type AssumptionKey = Exclude<keyof Assumptions, "example">;

const FIELDS: Record<AssumptionKey, { label: string; unit: string; hint: string; step: string }> = {
  inflation: { label: "Inflation over the 12 months", unit: "% a year", hint: "Consumer prices, year on year (CAPMAS urban headline inflation).", step: "0.1" },
  fxStart: { label: "USD rate at the start", unit: "EGP per USD", hint: "Central Bank of Egypt rate on the first day of the 12 months.", step: "0.01" },
  fxEnd: { label: "USD rate at the end", unit: "EGP per USD", hint: "Central Bank of Egypt rate on the last day.", step: "0.01" },
  importShare: { label: "Imported share of stock", unit: "%", hint: "Imported stock is repriced with the dollar, local stock with inflation.", step: "1" },
  assetAge: { label: "Average age of fixed assets", unit: "years", hint: "From the fixed-asset register; used for depreciation at today's prices.", step: "0.5" },
  rate: { label: "Borrowing rate", unit: "% a year", hint: "What your bank charges, or quotes, on loans.", step: "0.1" },
  principal12m: { label: "Loan repayments due in 12 months", unit: "amount", hint: "Principal only, from your loan schedule. Leave empty to estimate.", step: "1000" },
  tenor: { label: "Tenor for a new loan", unit: "years", hint: "Years over which a new loan would be repaid.", step: "1" },
};

/** Assumptions held in the page; saved to the company when the user may edit it. */
export function useAssumptions() {
  const c = useCompany();
  const [a, setA] = useState<Assumptions>(c.assumptions ?? {});
  return { a, setA, saved: c.assumptions ?? {} };
}

export function AssumptionsPanel({ fields, a, setA, saved, title = "Your assumptions" }: {
  fields: AssumptionKey[]; a: Assumptions; setA: (a: Assumptions) => void; saved: Assumptions; title?: string;
}) {
  const c = useCompany();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canSave = !c.readOnly && c.source !== "demo";
  const dirty = fields.some((k) => (a[k] ?? null) !== (saved[k] ?? null));
  const save = () => start(async () => {
    const all: Record<string, number | null> = {};
    for (const k of Object.keys(FIELDS) as AssumptionKey[]) all[k] = a[k] ?? null;
    const r = await saveAssumptions(c.id, all);
    setMsg(r.ok ? { ok: true, text: "Saved for this company." } : { ok: false, text: r.error ?? "Could not save" });
    if (r.ok) router.refresh();
  });
  return (
    <section className="rounded-lg border border-line p-4" data-testid="assumptions">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-normal">{title}</h2>
        {a.example && <span className="rounded bg-amber/20 px-2 py-0.5 text-xs text-[#9a6b00]">Example figures for the demo. Enter your own.</span>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((k) => {
          const f = FIELDS[k];
          const unit = f.unit === "amount" ? c.settings.currency : f.unit;
          return (
            <label key={k} className="block">
              <span className="label mb-1 block">{f.label}</span>
              <span className="flex items-center gap-2">
                <input type="number" inputMode="decimal" step={f.step} value={a[k] ?? ""} data-testid={`assume-${k}`}
                  onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); setA({ ...a, [k]: Number.isFinite(v) ? v : null, example: false }); setMsg(null); }}
                  className="w-full rounded border border-line px-3 py-2 text-right outline-none focus:border-brand" />
                <span className="w-24 shrink-0 text-xs text-mute">{unit}</span>
              </span>
              <span className="mt-1 block text-xs text-mute">{f.hint}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {msg && <span className={cn("mr-auto text-sm", msg.ok ? "text-green-d" : "text-red")} role="status">{msg.text}</span>}
        {canSave ? <button onClick={save} disabled={!dirty || pending} className="rounded bg-brand-d px-5 py-2 font-medium text-white disabled:opacity-50" data-testid="save-assumptions">{pending ? "Saving…" : "Save assumptions"}</button>
          : <span className="text-xs text-mute">{c.source === "demo" ? "Changes apply to this view only." : "You have view-only access; changes apply to this view only."}</span>}
      </div>
    </section>
  );
}

export const fmtX = (v: number | null) => (v === null ? "–" : `${v.toFixed(2)}x`);
