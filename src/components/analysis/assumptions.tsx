"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { REQUEST_LABEL, REQUEST_LABEL_AR, REQUEST_TYPES, type Assumptions } from "@/lib/engine";
import { useT } from "@/lib/i18n/use-t";
import { useCompany } from "@/lib/company/context";
import { saveAssumptions } from "@/app/company/[id]/settings/actions";
import { cn } from "@/lib/cn";

export type AssumptionKey = Exclude<keyof Assumptions, "example">;

/** How each assumption is entered; its label, unit and hint come from the dictionary (d.bank.as.fields). */
type Field = { wide?: boolean } & ({ kind: "number"; step: string } | { kind: "text" } | { kind: "select"; options: readonly string[] });

const FIELDS: Record<AssumptionKey, Field> = {
  inflation: { kind: "number", step: "0.1" },
  fxStart: { kind: "number", step: "0.01" },
  fxEnd: { kind: "number", step: "0.01" },
  importShare: { kind: "number", step: "1" },
  assetAge: { kind: "number", step: "0.5" },
  rate: { kind: "number", step: "0.1" },
  principal12m: { kind: "number", step: "1000" },
  tenor: { kind: "number", step: "1" },
  requestAmount: { kind: "number", step: "10000" },
  requestType: { kind: "select", options: REQUEST_TYPES },
  requestPurpose: { kind: "text", wide: true },
};

/** Assumptions held in the page; saved to the company when the user may edit it. */
export function useAssumptions() {
  const c = useCompany();
  const [a, setA] = useState<Assumptions>(c.assumptions ?? {});
  return { a, setA, saved: c.assumptions ?? {} };
}

export function AssumptionsPanel({ fields, a, setA, saved, title, columns = 3 }: {
  fields: AssumptionKey[]; a: Assumptions; setA: (a: Assumptions) => void; saved: Assumptions; title?: string; columns?: 2 | 3;
}) {
  const c = useCompany();
  const router = useRouter();
  const { lang, d: { bank: { as: t } } } = useT();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const canSave = !c.readOnly && c.source !== "demo";
  const dirty = fields.some((k) => (a[k] ?? null) !== (saved[k] ?? null));
  const set = (k: AssumptionKey, v: unknown) => { setA({ ...a, [k]: v, example: false }); setMsg(null); };
  const save = () => start(async () => {
    const all: Record<string, unknown> = {};
    for (const k of Object.keys(FIELDS) as AssumptionKey[]) all[k] = a[k] ?? null;
    const r = await saveAssumptions(c.id, all as Parameters<typeof saveAssumptions>[1]);
    setMsg(r.ok ? { ok: true, text: t.saved } : { ok: false, text: r.error ?? t.couldNot });
    if (r.ok) router.refresh();
  });
  const input = "w-full rounded border border-line px-3 py-2 outline-none focus:border-brand";
  return (
    <section className="rounded-lg border border-line p-4" data-testid="assumptions">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-normal">{title ?? t.title}</h2>
        {a.example && <span className="rounded bg-amber/20 px-2 py-0.5 text-xs text-[#9a6b00]">{t.example}</span>}
      </div>
      <div className={cn("grid gap-4 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}>
        {fields.map((k) => {
          const f = FIELDS[k];
          const [label, unit, hint] = t.fields[k];
          return (
            <label key={k} className={cn("block", f.wide && "sm:col-span-2", f.wide && columns === 3 && "lg:col-span-3")}>
              <span className="label mb-1 block">{label}</span>
              {f.kind === "number" ? (
                <span className="flex items-center gap-2">
                  <input type="number" inputMode="decimal" step={f.step} value={(a[k] as number | null | undefined) ?? ""} data-testid={`assume-${k}`}
                    onChange={(e) => { const v = e.target.value === "" ? null : Number(e.target.value); set(k, Number.isFinite(v) ? v : null); }}
                    className={cn(input, "text-end")} />
                  <span className="w-24 shrink-0 text-xs text-mute">{unit === "¤" ? c.settings.currency : unit}</span>
                </span>
              ) : f.kind === "select" ? (
                <select value={(a[k] as string | null | undefined) ?? ""} onChange={(e) => set(k, e.target.value || null)} className={input} data-testid={`assume-${k}`}>
                  <option value="">{t.choose}</option>
                  {f.options.map((o) => <option key={o} value={o}>{(lang === "ar" ? REQUEST_LABEL_AR : REQUEST_LABEL)[o as keyof typeof REQUEST_LABEL]}</option>)}
                </select>
              ) : (
                <input type="text" maxLength={300} value={(a[k] as string | null | undefined) ?? ""} placeholder={unit} onChange={(e) => set(k, e.target.value || null)} className={input} data-testid={`assume-${k}`} />
              )}
              <span className="mt-1 block text-xs text-mute">{hint}</span>
            </label>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        {msg && <span className={cn("me-auto text-sm", msg.ok ? "text-green-d" : "text-red")} role="status">{msg.text}</span>}
        {canSave ? <button onClick={save} disabled={!dirty || pending} className="rounded bg-brand-d px-5 py-2 font-medium text-white disabled:opacity-50" data-testid="save-assumptions">{pending ? t.saving : t.save}</button>
          : <span className="text-xs text-mute">{c.source === "demo" ? t.demo : t.viewOnly}</span>}
      </div>
    </section>
  );
}

export const fmtX = (v: number | null) => (v === null ? "–" : `${v.toFixed(2)}x`);
