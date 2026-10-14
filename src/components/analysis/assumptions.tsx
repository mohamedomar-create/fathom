"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { REQUEST_LABEL, REQUEST_TYPES, type Assumptions } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { saveAssumptions } from "@/app/company/[id]/settings/actions";
import { cn } from "@/lib/cn";

export type AssumptionKey = Exclude<keyof Assumptions, "example">;

type Field = { label: string; hint: string; wide?: boolean } & (
  | { kind: "number"; unit: string; step: string }
  | { kind: "text"; placeholder: string }
  | { kind: "select"; options: { value: string; label: string }[] }
);

const FIELDS: Record<AssumptionKey, Field> = {
  inflation: { kind: "number", label: "Inflation over the 12 months", unit: "% a year", hint: "Consumer prices, year on year (CAPMAS urban headline inflation).", step: "0.1" },
  fxStart: { kind: "number", label: "USD rate at the start", unit: "EGP per USD", hint: "Central Bank of Egypt rate on the first day of the 12 months.", step: "0.01" },
  fxEnd: { kind: "number", label: "USD rate at the end", unit: "EGP per USD", hint: "Central Bank of Egypt rate on the last day.", step: "0.01" },
  importShare: { kind: "number", label: "Imported share of stock", unit: "%", hint: "Imported stock is repriced with the dollar, local stock with inflation.", step: "1" },
  assetAge: { kind: "number", label: "Average age of fixed assets", unit: "years", hint: "From the fixed-asset register; used for depreciation at today's prices.", step: "0.5" },
  rate: { kind: "number", label: "Borrowing rate", unit: "% a year", hint: "What your bank charges, or quotes, on loans.", step: "0.1" },
  principal12m: { kind: "number", label: "Loan repayments due in 12 months", unit: "amount", hint: "Principal only, from your loan schedule. Leave empty to estimate.", step: "1000" },
  tenor: { kind: "number", label: "Tenor for a new loan", unit: "years", hint: "Years over which a new loan would be repaid.", step: "1" },
  requestAmount: { kind: "number", label: "Amount you will ask for", unit: "amount", hint: "The new loan or facility, on top of what you owe today.", step: "10000" },
  requestType: { kind: "select", label: "Type of facility", hint: "Term loans are repaid in instalments; working-capital lines are renewed yearly.", options: REQUEST_TYPES.map((t) => ({ value: t, label: REQUEST_LABEL[t] })) },
  requestPurpose: { kind: "text", label: "What it is for", placeholder: "e.g. a second warehouse in 6th of October", hint: "One line; it goes into the memo.", wide: true },
};

/** Assumptions held in the page; saved to the company when the user may edit it. */
export function useAssumptions() {
  const c = useCompany();
  const [a, setA] = useState<Assumptions>(c.assumptions ?? {});
  return { a, setA, saved: c.assumptions ?? {} };
}

export function AssumptionsPanel({ fields, a, setA, saved, title = "Your assumptions", columns = 3 }: {
  fields: AssumptionKey[]; a: Assumptions; setA: (a: Assumptions) => void; saved: Assumptions; title?: string; columns?: 2 | 3;
}) {
  const c = useCompany();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canSave = !c.readOnly && c.source !== "demo";
  const dirty = fields.some((k) => (a[k] ?? null) !== (saved[k] ?? null));
  const set = (k: AssumptionKey, v: unknown) => { setA({ ...a, [k]: v, example: false }); setMsg(null); };
  const save = () => start(async () => {
    const all: Record<string, unknown> = {};
    for (const k of Object.keys(FIELDS) as AssumptionKey[]) all[k] = a[k] ?? null;
    const r = await saveAssumptions(c.id, all as Parameters<typeof saveAssumptions>[1]);
    setMsg(r.ok ? { ok: true, text: "Saved for this company." } : { ok: false, text: r.error ?? "Could not save" });
    if (r.ok) router.refresh();
  });
  const input = "w-full rounded border border-line px-3 py-2 outline-none focus:border-brand";
  return (
    <section className="rounded-lg border border-line p-4" data-testid="assumptions">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-normal">{title}</h2>
        {a.example && <span className="rounded bg-amber/20 px-2 py-0.5 text-xs text-[#9a6b00]">Example figures for the demo. Enter your own.</span>}
      </div>
      <div className={cn("grid gap-4 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}>
        {fields.map((k) => {
          const f = FIELDS[k];
          return (
            <label key={k} className={cn("block", f.wide && "sm:col-span-2", f.wide && columns === 3 && "lg:col-span-3")}>
              <span className="label mb-1 block">{f.label}</span>
              {f.kind === "number" ? (
                <span className="flex items-center gap-2">
                  <input type="number" inputMode="decimal" step={f.step} value={(a[k] as number | null | undefined) ?? ""} data-testid={`assume-${k}`}
                    onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); set(k, Number.isFinite(v) ? v : null); }}
                    className={cn(input, "text-end")} />
                  <span className="w-24 shrink-0 text-xs text-mute">{f.unit === "amount" ? c.settings.currency : f.unit}</span>
                </span>
              ) : f.kind === "select" ? (
                <select value={(a[k] as string | null | undefined) ?? ""} onChange={(e) => set(k, e.target.value || null)} className={input} data-testid={`assume-${k}`}>
                  <option value="">Choose…</option>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" maxLength={300} value={(a[k] as string | null | undefined) ?? ""} placeholder={f.placeholder} onChange={(e) => set(k, e.target.value || null)} className={input} data-testid={`assume-${k}`} />
              )}
              <span className="mt-1 block text-xs text-mute">{f.hint}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {msg && <span className={cn("me-auto text-sm", msg.ok ? "text-green-d" : "text-red")} role="status">{msg.text}</span>}
        {canSave ? <button onClick={save} disabled={!dirty || pending} className="rounded bg-brand-d px-5 py-2 font-medium text-white disabled:opacity-50" data-testid="save-assumptions">{pending ? "Saving…" : "Save assumptions"}</button>
          : <span className="text-xs text-mute">{c.source === "demo" ? "Changes apply to this view only." : "You have view-only access; changes apply to this view only."}</span>}
      </div>
    </section>
  );
}

export const fmtX = (v: number | null) => (v === null ? "–" : `${v.toFixed(2)}x`);
