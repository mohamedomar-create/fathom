"use client";
import { useState, useTransition } from "react";
import { useCompany } from "@/lib/company/context";
import { saveHighlightThresholds } from "@/app/company/[id]/analysis/highlight-actions";
import { DEFAULT_HIGHLIGHTS } from "@/lib/engine/statement-rows";
import { useT } from "@/lib/i18n/use-t";
import { useMsg } from "@/lib/i18n/msg";

/** When a statement line is flagged: a move of at least this percentage AND at least this amount. */
export function HighlightThresholds() {
  const c = useCompany();
  const T = useT();
  const m = useMsg();
  const h = c.settings.highlights ?? DEFAULT_HIGHLIGHTS;
  const [pctV, setPct] = useState(String(h.pct));
  const [amt, setAmt] = useState(String(h.amount));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const canSave = !c.readOnly && c.source !== "demo";
  const save = () => start(async () => {
    const r = await saveHighlightThresholds(c.id, Number(pctV), Number(amt));
    setMsg(r.ok ? { ok: true, text: T.d.hl.saved } : { ok: false, text: m(r.error ?? "") });
  });
  const field = "w-32 rounded border border-line px-2 py-1 text-end";
  return (
    <section className="mt-10 rounded-md border border-line p-4" data-testid="highlight-thresholds">
      <h2 className="text-lg font-semibold">{T.d.hl.thresholds}</h2>
      <p className="mb-3 text-sm text-mute">{T.d.hl.thresholdsHelp}</p>
      <div className="flex flex-wrap items-end gap-4">
        <label><span className="label mb-1 block">{T.d.hl.pctLabel}</span><input type="number" min={1} step="any" inputMode="decimal" className={field} value={pctV} disabled={!canSave} onChange={(e) => setPct(e.target.value)} data-testid="hl-pct" /></label>
        <label><span className="label mb-1 block">{T.d.hl.amountLabel(c.settings.currency)}</span><input type="number" min={1} step="any" inputMode="decimal" className={field} value={amt} disabled={!canSave} onChange={(e) => setAmt(e.target.value)} data-testid="hl-amount" /></label>
        {canSave && <button type="button" disabled={pending} onClick={save} className="rounded bg-brand-d px-4 py-1.5 text-white disabled:opacity-50" data-testid="hl-save">{T.d.hl.saveMark}</button>}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "mt-2 text-sm text-green-d" : "mt-2 text-sm text-red"} data-testid="hl-msg">{msg.text}</p>}
    </section>
  );
}
