"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CAT_COL, CAT_ORDER, KPI_DEFS, num, type Importance } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useAnalysis } from "@/lib/company/use-period";
import { saveKpiConfig } from "@/app/company/[id]/settings/actions";
import { cn } from "@/lib/cn";

type Mode = "kpis" | "targets" | "alerts";
type Entry = { active: boolean; importance: Importance; target: number | null; alert_active: boolean; alert_threshold: number | null };
const UNIT_BADGE: Record<string, string> = { cur: "¤", "%": "%", days: "days", times: "times", ratio: ":1", num: "" };
const IMP: Importance[] = ["Critical", "High", "Medium", "Low"];
const IMP_COL: Record<Importance, string> = { Critical: "bg-red-bg text-red", High: "bg-[#fdebd9] text-[#b4621a]", Medium: "bg-[#e3eefb] text-[#2a6cc0]", Low: "bg-band text-mute" };

export function KpiConfigForm({ mode }: { mode: Mode }) {
  const c = useCompany();
  const a = useAnalysis();
  const router = useRouter();
  const initial = useMemo(() => {
    const act = c.settings.activeKpis;
    return Object.fromEntries(KPI_DEFS.map((d) => [d.key, {
      active: act ? act.includes(d.key) : d.defaultActive,
      importance: c.settings.importance?.[d.key] ?? d.importance,
      target: c.settings.targets && d.key in c.settings.targets ? c.settings.targets[d.key] ?? null : d.target,
      alert_active: c.alerts[d.key]?.active ?? false,
      alert_threshold: c.alerts[d.key]?.threshold ?? d.target,
    } as Entry]));
  }, [c.settings, c.alerts]);
  const [cfg, setCfg] = useState<Record<string, Entry>>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(initial);
  const set = (k: string, patch: Partial<Entry>) => { setCfg((x) => ({ ...x, [k]: { ...x[k], ...patch } })); setMsg(null); };
  const save = () => start(async () => {
    const r = await saveKpiConfig(c.id, cfg);
    setMsg(r.ok ? { ok: true, text: "Saved. KPIs, the summary and reports now use these settings." } : { ok: false, text: r.error ?? "Could not save" });
    if (r.ok) router.refresh();
  });
  const defs = mode === "kpis" ? KPI_DEFS : KPI_DEFS.filter((d) => cfg[d.key].active);
  const activeCount = KPI_DEFS.filter((d) => cfg[d.key].active).length;
  const cur = c.settings.currency;
  return (
    <div>
      {mode === "kpis" && <p className="mb-4 text-sm text-mute"><b className="text-ink">{activeCount} active KPIs.</b> Turn KPIs on or off and set how important each one is. Critical KPIs that miss target are called out in the summary.</p>}
      {mode === "targets" && <p className="mb-4 text-sm text-mute">Set a monthly performance target for each active KPI. For quarter and year views, currency targets are compared with the period total.</p>}
      {mode === "alerts" && <p className="mb-4 text-sm text-mute">Turn on alerts and set thresholds. A red dot appears next to the KPI when the threshold is crossed, and it is counted under “Alerts”.</p>}
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="tbl text-[13px]">
          <thead>
            <tr>
              <th>KPI</th>
              {a && <th>Latest</th>}
              {mode === "kpis" && <><th>Importance</th><th>Active</th></>}
              {mode === "targets" && <th>Monthly target</th>}
              {mode === "alerts" && <><th>Alert when</th><th>Threshold</th><th>Active</th></>}
            </tr>
          </thead>
          <tbody>
            {CAT_ORDER.map((cat) => {
              const list = defs.filter((d) => d.category === cat);
              if (!list.length) return null;
              return [
                <tr key={cat} className="cat"><td colSpan={6}><span className="mr-2 inline-block h-3 w-3 rounded-sm align-[-1px]" style={{ background: CAT_COL[cat] }} />{cat}</td></tr>,
                ...list.map((d) => {
                  const e = cfg[d.key];
                  return (
                    <tr key={d.key} className={cn("row", mode === "kpis" && !e.active && "text-mute")}>
                      <td className="min-w-52">{d.name}{d.direction === "down" ? "*" : ""}<div className="text-[11px] text-mute">{d.formula.split("=")[1]?.trim()}</div></td>
                      {a && <td className="text-mute">{num(a.K[d.key] ?? null, d.unit, cur)}</td>}
                      {mode === "kpis" && (
                        <>
                          <td>
                            <select disabled={c.readOnly} value={e.importance} onChange={(ev) => set(d.key, { importance: ev.target.value as Importance })} className={cn("rounded-full px-2.5 py-1 text-xs font-medium outline-none", IMP_COL[e.importance])}>
                              {IMP.map((i) => <option key={i}>{i}</option>)}
                            </select>
                          </td>
                          <td><Toggle on={e.active} disabled={c.readOnly} onChange={(v) => set(d.key, { active: v })} label={`Activate ${d.name}`} /></td>
                        </>
                      )}
                      {mode === "targets" && (
                        <td><NumIn value={e.target} onChange={(v) => set(d.key, { target: v })} unit={UNIT_BADGE[d.unit] === "¤" ? cur : UNIT_BADGE[d.unit]} disabled={c.readOnly} label={`${d.name} target`} /></td>
                      )}
                      {mode === "alerts" && (
                        <>
                          <td className="text-mute">{d.direction === "up" ? "is less than" : "exceeds"}</td>
                          <td><NumIn value={e.alert_threshold} onChange={(v) => set(d.key, { alert_threshold: v })} unit={UNIT_BADGE[d.unit] === "¤" ? cur : UNIT_BADGE[d.unit]} disabled={c.readOnly} label={`${d.name} threshold`} /></td>
                          <td><Toggle on={e.alert_active} disabled={c.readOnly} onChange={(v) => set(d.key, { alert_active: v })} label={`Alert for ${d.name}`} /></td>
                        </>
                      )}
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-mute">* A result below target is favourable for this KPI.</p>
      <div className="sticky bottom-0 mt-4 flex items-center justify-end gap-3 border-t border-line bg-white/95 py-3 backdrop-blur">
        {msg && <span className={cn("mr-auto text-sm", msg.ok ? "text-green-d" : "text-red")}>{msg.text}</span>}
        {c.readOnly ? <span className="text-sm text-mute">{c.basePath === "/demo" ? "The demo company is read-only." : "You have view-only access."}</span> : (
          <>
            <button onClick={() => setCfg(initial)} disabled={!dirty || pending} className="rounded px-4 py-2 text-mute hover:bg-band disabled:opacity-40">Discard</button>
            <button onClick={save} disabled={!dirty || pending} className="rounded bg-brand-d px-5 py-2 font-medium text-white disabled:opacity-50" data-testid="save-kpis">{pending ? "Saving…" : "Save changes"}</button>
          </>
        )}
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={cn("relative inline-flex h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50", on ? "bg-brand-d" : "bg-[#d5d5d0]")}>
      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", on ? "left-[18px]" : "left-0.5")} />
    </button>
  );
}

function NumIn({ value, onChange, unit, disabled, label }: { value: number | null; onChange: (v: number | null) => void; unit: string; disabled?: boolean; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <input type="number" step="any" aria-label={label} disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="w-32 rounded border border-line px-2 py-1 text-right outline-none focus:border-brand disabled:bg-band" />
      <span className="w-10 text-xs text-mute">{unit}</span>
    </span>
  );
}
