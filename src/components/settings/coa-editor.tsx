"use client";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { money, type ClassKey } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import type { AccountLine } from "@/lib/company/types";
import { CLASS_LABEL, CLASS_OPTIONS } from "@/lib/ingest/pipeline";
import { isPL } from "@/lib/company/build";
import { reclassify } from "@/app/company/[id]/settings/actions";
import { cn } from "@/lib/cn";

const PAIRS: Partial<Record<ClassKey, ClassKey>> = { cos_variable: "cos_fixed", cos_fixed: "cos_variable", exp_variable: "exp_fixed", exp_fixed: "exp_variable" };
const BEHAVIOUR: Partial<Record<ClassKey, string>> = { cos_variable: "VARIABLE", exp_variable: "VARIABLE", cos_fixed: "FIXED", exp_fixed: "FIXED", cos_depreciation: "DEPRECIATION", exp_depreciation: "DEPRECIATION" };

export function CoaEditor() {
  const c = useCompany();
  const router = useRouter();
  const [tab, setTab] = useState<"PL" | "BS">("PL");
  const [q, setQ] = useState("");
  const [changes, setChanges] = useState<Record<string, ClassKey>>({});
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const last = c.months[c.months.length - 1]?.period;
  const fyTotal = (amounts: Record<string, number>) => c.months.slice(-12).reduce((s, m) => s + (amounts[m.period] ?? 0), 0);
  const groups = useMemo(() => {
    const out = new Map<ClassKey, AccountLine[]>();
    for (const a of c.accounts) {
      const cls = changes[a.id] ?? a.cls;
      if (isPL(cls) !== (tab === "PL")) continue;
      if (q && !`${a.code} ${a.name}`.toLowerCase().includes(q.toLowerCase())) continue;
      out.set(cls, [...(out.get(cls) ?? []), a]);
    }
    return CLASS_OPTIONS.filter((k) => out.has(k)).map((k) => [k, out.get(k)!] as const);
  }, [c.accounts, changes, tab, q]);
  const save = () => start(async () => {
    const r = await reclassify(c.id, changes);
    if (!r.ok) { setMsg(r.error ?? "Could not save"); return; }
    setChanges({}); setMsg(`${r.count} account(s) reclassified. All analysis now uses the new mapping.`);
    router.refresh();
  });
  if (!c.accounts.length) return <p className="text-mute">No accounts yet — import data first.</p>;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-md bg-band p-1 text-sm">
          {(["PL", "BS"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={cn("rounded px-3 py-1", tab === t ? "bg-white font-semibold shadow-sm" : "text-mute")}>{t === "PL" ? "P&L" : "Balance Sheet"}</button>)}
        </div>
        <label className="flex items-center gap-2 rounded border border-line px-2.5 py-1.5 text-sm"><Search className="h-4 w-4 text-mute" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" className="outline-none" /></label>
      </div>
      {groups.map(([cls, accts]) => (
        <div key={cls} className="mb-5">
          <div className="mb-1 flex items-center gap-2 border-b border-ink pb-1 text-xs font-bold uppercase tracking-wider">
            <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-bar text-[10px] text-white">{CLASS_LABEL[cls][0]}</span>{CLASS_LABEL[cls]} <span className="font-normal text-mute">· {accts.length}</span>
          </div>
          {accts.map((a) => {
            const now = changes[a.id] ?? a.cls;
            return (
              <div key={a.id} className={cn("grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line py-2 text-[13px] sm:grid-cols-[1fr_110px_120px_220px]", changes[a.id] && "bg-amber/10")}>
                <div><span className="mr-2 text-xs text-mute">{a.code}</span>{a.name}</div>
                <div className="hidden sm:block">{BEHAVIOUR[now] && (
                  <button disabled={c.readOnly || !PAIRS[now]} onClick={() => setChanges((x) => ({ ...x, [a.id]: PAIRS[now]! }))} title={PAIRS[now] ? "Click to switch fixed / variable" : undefined}
                    className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wider", BEHAVIOUR[now] === "VARIABLE" ? "bg-[#fdebd9] text-[#b4621a]" : BEHAVIOUR[now] === "FIXED" ? "bg-[#e3eefb] text-[#2a6cc0]" : "bg-band text-mute")}>{BEHAVIOUR[now]}</button>
                )}</div>
                <div className="num hidden text-right text-mute sm:block">{money(isPL(now) ? fyTotal(a.amounts) : a.amounts[last ?? ""] ?? 0, c.settings.currency, true)}</div>
                <select disabled={c.readOnly} value={now} onChange={(e) => setChanges((x) => ({ ...x, [a.id]: e.target.value as ClassKey }))} aria-label={`Reclassify ${a.name}`}
                  className="max-w-56 rounded border border-line px-1.5 py-1 text-xs">
                  {CLASS_OPTIONS.map((k) => <option key={k} value={k}>{CLASS_LABEL[k]}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      ))}
      <p className="text-xs text-mute">Amounts: P&amp;L = last 12 months; balance sheet = latest month. Fixed/variable drives the breakeven and goalseek tools — ask “if sales doubled, would this cost roughly double?”</p>
      <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-3 border-t border-line bg-white/95 py-3 backdrop-blur">
        {msg && <span className="mr-auto text-sm text-green-d">{msg}</span>}
        {c.readOnly ? <span className="text-sm text-mute">Read-only.</span> : (
          <>
            <span className="text-sm text-mute">{Object.keys(changes).length} change(s)</span>
            <button onClick={() => setChanges({})} disabled={!Object.keys(changes).length} className="rounded px-4 py-2 text-mute hover:bg-band disabled:opacity-40">Discard</button>
            <button onClick={save} disabled={!Object.keys(changes).length || pending} className="rounded bg-green-d px-5 py-2 font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save mapping"}</button>
          </>
        )}
      </div>
    </div>
  );
}
