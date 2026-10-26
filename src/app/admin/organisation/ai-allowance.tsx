"use client";
import { useState, useTransition } from "react";
import { setAiAllowance } from "../actions";
import { useDict } from "@/lib/i18n/context";

/** The organisation's monthly AI allowance and this month's use; the owner can change it. */
export function AiAllowance({ orgId, usd, usedMicros, isOwner }: { orgId: string; usd: number; usedMicros: number; isOwner: boolean }) {
  const a = useDict().access;
  const [value, setValue] = useState(String(usd));
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const used = usedMicros / 1_000_000;
  return (
    <section className="mt-10 rounded-md border border-line p-4" data-testid="ai-allowance">
      <h3 className="font-medium">{a.aiTitle}</h3>
      <p className="mb-3 text-sm text-mute">{a.aiUsed(used.toFixed(2), String(usd))}</p>
      {isOwner && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await setAiAllowance(orgId, Number(value)); setMsg(r.ok ? a.aiSaved : r.error ?? null); }); }}>
          <label className="text-sm">{a.aiLimit} <input type="number" min={0} max={200} step={1} value={value} onChange={(e) => setValue(e.target.value)} data-testid="ai-limit"
            className="ms-2 w-24 rounded border border-line px-2 py-1" /></label>
          <button disabled={pending} className="rounded bg-brand-d px-3 py-1.5 text-sm text-white disabled:opacity-60" data-testid="ai-save">{a.save}</button>
        </form>
      )}
      {msg && <p role="status" className="mt-2 text-sm">{msg}</p>}
    </section>
  );
}
