"use client";
// Smart upload: any number of workbooks, every tab read and split into its tables, each table placed in its module (sure,
// "please confirm", or "needs you" with AI assist on a sample), its columns mapped, its rows read with the money proved,
// the tabs checked against each other, a preview in AQL360's layout, then a save module by module with a report.
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Grid } from "@/lib/ingest/extract";
import { readForUpload } from "@/lib/imports/worker-client";
import { supportedFile } from "@/lib/preflight/export";
import { MODULES, moduleByKey } from "@/lib/modules/registry";
import { planIntake, placePiece, type PlannedPiece } from "@/lib/intake/plan";
import { reconcile } from "@/lib/intake/reconcile";
import { templateOf } from "@/lib/intake/adapters";
import { checkSuggestion, sampleOf, type CheckedSuggestion, type Suggestion } from "@/lib/intake/ai-sample";
import { savePiece, saveOrder } from "@/lib/intake/save";
import type { SavedLayouts } from "@/lib/intake/memory";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";

type Phase = "upload" | "review" | "preview" | "save" | "done";
interface Choice { module?: string | null; override?: Record<number, string | null>; headerRow?: number; asOf?: string; anyway?: boolean; ai?: CheckedSuggestion | null }

const STEPS = ["read", "split", "understand", "map", "check", "preview", "save", "done"] as const;
const at: Record<Phase, number> = { upload: 0, review: 4, preview: 5, save: 6, done: 7 };
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const LAYOUT_STEP: Record<string, string> = { statement: "financials", cashbook: "financials", bank: "financials", stock_valuation: "inventory", stock_moves: "inventory", stock_onhand: "inventory", products: "inventory", odoo_payments: "payments", odoo_aged: "payments" };

function Rail({ phase }: { phase: Phase }) {
  const { d } = useT();
  return (
    <ol className="mb-6 flex flex-wrap gap-1 text-xs" data-testid="intake-rail" aria-label={d.ink.title}>
      {STEPS.map((k, i) => (
        <li key={k} aria-current={i === at[phase] ? "step" : undefined} className={cn("rounded-full px-3 py-1", i < at[phase] ? "bg-brand-bg text-brand-d" : i === at[phase] ? "bg-brand-d font-semibold text-white" : "bg-band text-mute")}>{i + 1}. {d.ink.steps[k]}</li>
      ))}
    </ol>
  );
}

async function download(name: string, grids: Grid[]) {
  const { toXlsx } = await import("@/lib/preflight/export");
  const bytes = await toXlsx(grids);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export function SmartIntake({ companyId, currency, saved, base }: { companyId: string; currency: string; saved: SavedLayouts; base: string }) {
  const { d, lang } = useT();
  const t = d.ink;
  const [phase, setPhase] = useState<Phase>("upload");
  const [grids, setGrids] = useState<Grid[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [saving, setSaving] = useState<{ done: Record<string, number>; current: string | null; failed: { id: string; error: string } | null }>({ done: {}, current: null, failed: null });
  const mname = (k: string | null | undefined) => (k ? (lang === "ar" ? moduleByKey(k)?.name.ar : moduleByKey(k)?.name.en) ?? k : "");

  const base0 = useMemo(() => (grids ? planIntake(grids, { saved }) : null), [grids, saved]);
  // The plan with the person's choices: a module picked, a column pointed at a field, an as-of day.
  const pieces = useMemo<PlannedPiece[]>(() => (base0?.pieces ?? []).map((p) => {
    const c = choices[p.id];
    if (!c || (c.module === undefined && !c.override && c.headerRow === undefined && !c.asOf)) return p;
    const mod = c.module === undefined ? p.module : c.module;
    if (p.layout && c.module === undefined) return p;
    return { ...placePiece(p.piece, mod, { remembered: p.remembered }, { override: c.override, headerRow: c.headerRow, asOf: c.asOf }), band: mod === p.module ? p.band : "sure", why: mod === p.module ? p.why : `${t.module}: ${mname(mod)}` };
  }), [base0, choices]); // eslint-disable-line react-hooks/exhaustive-deps
  const included = pieces.filter((p) => choices[p.id]?.module !== null && p.module && (p.layout ? p.layout === "odoo_aged" && !!p.aged : !!p.read));
  const checks = useMemo(() => reconcile(included.filter((p) => p.read).map((p) => ({ id: p.id, module: p.module!, records: p.read!.records }))), [included]);
  const blocked = pieces.some((p) => {
    if (choices[p.id]?.module === null || p.layout) return false;
    if (!p.module) return true;
    return (p.map?.missing.length ?? 0) > 0 || (p.needs?.length ?? 0) > 0 || (!p.read?.proof.ok && !choices[p.id]?.anyway);
  });
  const set = (id: string, c: Partial<Choice>) => setChoices((x) => ({ ...x, [id]: { ...x[id], ...c } }));

  async function read(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setErr(null);
    try {
      const ok = [...files].filter((f) => supportedFile(f.name) && f.size <= 25 * 1024 * 1024);
      if (!ok.length) throw new Error(t.dropHint);
      const { grids } = await readForUpload(await Promise.all(ok.map(async (f) => ({ name: f.name, data: await f.arrayBuffer() }))));
      setGrids(grids); setChoices({}); setPhase("review");
    } catch (e) { setErr((e as Error).message || t.readFail); }
    finally { setBusy(false); }
  }

  async function askAi(p: PlannedPiece) {
    setAsking(p.id); setErr(null);
    try {
      const res = await fetch(`/api/companies/${companyId}/understand`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sample: sampleOf(p.piece) }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || t.readFail);
      set(p.id, { ai: checkSuggestion(body.suggestion as Suggestion, p.piece) });
    } catch (e) { setErr((e as Error).message); }
    finally { setAsking(null); }
  }

  async function save() {
    setPhase("save"); setErr(null);
    const done = { ...saving.done };
    for (const p of saveOrder(included)) {
      if (p.id in done) continue;
      setSaving({ done, current: p.id, failed: null });
      const r = await savePiece(companyId, p, currency);
      if (!r.ok) { setSaving({ done, current: null, failed: { id: p.id, error: r.error } }); return; }
      done[p.id] = r.saved;
    }
    setSaving({ done, current: null, failed: null });
    setPhase("done");
  }

  if (phase === "upload") return (
    <div data-testid="intake" className="max-w-4xl">
      <Rail phase={phase} />
      <h2 className="mb-1 text-xl font-semibold">{t.title}</h2>
      <p className="mb-5 text-mute">{t.intro}</p>
      <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-line bg-band px-6 py-10 text-center hover:border-brand-d">
        <span className="rounded-md bg-brand-d px-5 py-2 font-medium text-white">{busy ? t.reading : t.drop}</span>
        <span className="mt-2 text-sm text-mute">{t.dropHint}</span>
        <input type="file" multiple accept=".xlsx,.xlsm,.xls,.csv,.txt,.tsv" className="sr-only" data-testid="intake-files" disabled={busy} onChange={(e) => void read(e.target.files)} />
      </label>
      {err && <p className="mt-4 text-red" role="alert" data-testid="intake-error">{err}</p>}
    </div>
  );

  if (phase === "done") return (
    <div data-testid="intake-done" className="max-w-4xl">
      <Rail phase={phase} />
      <h2 className="mb-3 text-xl font-semibold">{t.done}</h2>
      <ul className="space-y-2">
        {saveOrder(included).map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line px-4 py-3" data-testid="intake-done-row">
            <span>{t.doneRow(p.id, mname(p.module), saving.done[p.id] ?? 0)}</span>
            <Link prefetch={false} className="text-brand-d underline" href={`${base}/${moduleByKey(p.module!)?.sector === "payments" ? "payments" : moduleByKey(p.module!)?.key === "purchasing" ? "expenses/purchasing" : moduleByKey(p.module!)?.sector}`}>{t.see}</Link>
          </li>
        ))}
      </ul>
      <button type="button" className="mt-6 rounded-md border border-line px-4 py-2" onClick={() => { setGrids(null); setPhase("upload"); setSaving({ done: {}, current: null, failed: null }); }}>{t.start}</button>
    </div>
  );

  if (phase === "preview" || phase === "save") return (
    <div data-testid="intake-preview" className="max-w-6xl">
      <Rail phase={phase} />
      <h2 className="mb-1 text-xl font-semibold">{t.preview}</h2>
      <p className="mb-4 text-mute">{t.previewHint}</p>
      <button type="button" className="mb-5 rounded-md border border-line px-4 py-2 text-sm" data-testid="intake-download" onClick={() => void download("AQL360 templates.xlsx", included.filter((p) => p.read).map((p) => ({ ...templateOf(moduleByKey(p.module!)!, p.read!.records), name: `${mname(p.module)} – ${p.sheet}`.slice(0, 31) })))}>{t.downloadTemplates}</button>
      {included.filter((p) => !p.read).map((p) => <p key={p.id} className="mb-3 text-sm" data-testid="intake-preview-aged">{p.id} → {mname(p.module)}: {p.why}</p>)}
      {included.filter((p) => p.read).map((p) => {
        const g = templateOf(moduleByKey(p.module!)!, p.read!.records.slice(0, 8));
        return (
          <section key={p.id} className="mb-6" data-testid="intake-preview-table">
            <h3 className="mb-2 font-semibold">{p.id} → {mname(p.module)} <span className="font-normal text-mute">({t.rows(p.read!.records.length, p.read!.rejected.length, p.read!.skipped.length)})</span></h3>
            <div className="overflow-x-auto rounded border border-line">
              <table className="min-w-full text-sm">
                <thead className="bg-band"><tr>{g.rows[0].map((h, i) => <th key={i} className="px-3 py-2 text-start font-medium">{text(h)}</th>)}</tr></thead>
                <tbody>{g.rows.slice(1).map((r, i) => <tr key={i} className="border-t border-line">{r.map((v, j) => <td key={j} className="num whitespace-nowrap px-3 py-1.5">{text(v)}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="mb-3 text-sm text-mute">{t.replaces}</p>
      {saving.current && <p className="mb-3" role="status" data-testid="intake-saving">{t.saving(saving.current)}</p>}
      {saving.failed && <p className="mb-3 text-red" role="alert" data-testid="intake-save-error">{t.saveFail(saving.failed.id, saving.failed.error)}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="rounded-md border border-line px-4 py-2" disabled={phase === "save" && !saving.failed} onClick={() => setPhase("review")}>{t.back}</button>
        <button type="button" className="rounded-md bg-brand-d px-6 py-2 font-medium text-white disabled:opacity-50" data-testid="intake-save" disabled={(phase === "save" && !saving.failed) || !included.length} onClick={() => void save()}>{saving.failed ? t.retry : t.save}</button>
      </div>
    </div>
  );

  // Review: Understand, Map and Check, table by table.
  return (
    <div data-testid="intake-review" className="max-w-6xl">
      <Rail phase={phase} />
      <p className="mb-4 text-mute" data-testid="intake-counts">{t.tabs(grids?.length ?? 0)} · {t.tables(pieces.length)}</p>
      {pieces.map((p) => {
        const c = choices[p.id] ?? {};
        const out = c.module === null;
        const m = p.module ? moduleByKey(p.module) : null;
        const heads = p.map ? (p.piece.rows[p.map.headerRow] ?? []).map(text) : [];
        return (
          <section key={p.id} className={cn("mb-5 rounded-lg border px-4 py-4", out ? "border-line opacity-60" : p.band === "sure" ? "border-line" : "border-amber/60")} data-testid="intake-piece" data-module={out ? "none" : p.module ?? ""}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{p.id}</h3>
                {p.title && <p className="text-sm text-mute">{p.title}</p>}
                <p className="mt-1 text-sm"><span className={cn("me-2 rounded-full px-2 py-0.5 text-xs", p.band === "sure" ? "bg-brand-bg text-brand-d" : p.band === "likely" ? "bg-amber/15 text-ink" : "bg-red-bg text-red")} data-testid="intake-band">{t.band[p.band]}</span>{p.remembered ? t.remembered : p.why}</p>
              </div>
              {!p.layout && (
                <label className="text-sm">
                  <span className="me-2">{t.module}</span>
                  <select className="rounded border border-line px-2 py-1" data-testid="intake-module" value={out ? "" : p.module ?? "?"} onChange={(e) => set(p.id, { module: e.target.value === "" ? null : e.target.value, override: undefined, headerRow: undefined })}>
                    {!p.module && <option value="?" disabled>{t.pick}</option>}
                    {MODULES.map((x) => <option key={x.key} value={x.key}>{lang === "ar" ? x.name.ar : x.name.en}</option>)}
                    <option value="">{t.none}</option>
                  </select>
                </label>
              )}
            </div>
            {p.layout && (
              <p className="mt-3 text-sm">{p.layout === "odoo_aged" ? p.why : t.layout} {p.layout !== "odoo_aged" && <Link prefetch={false} className="text-brand-d underline" href={`${base}/data/upload?step=${LAYOUT_STEP[p.layout] ?? "financials"}`}>{t.layoutGo}</Link>}</p>
            )}
            {!out && !p.layout && p.band !== "sure" && (
              <div className="mt-3 rounded bg-band px-3 py-2 text-sm">
                {c.ai ? (
                  <p>{t.aiSuggests(mname(c.ai.module), c.ai.reason)} <button type="button" className="ms-2 rounded bg-brand-d px-3 py-1 text-white" data-testid="intake-ai-accept" onClick={() => set(p.id, { module: c.ai!.module, override: c.ai!.override, headerRow: c.ai!.headerRow, ai: null })}>{t.accept}</button></p>
                ) : (
                  <p><button type="button" className="rounded border border-line bg-white px-3 py-1" data-testid="intake-ai" disabled={asking === p.id} onClick={() => void askAi(p)}>{asking === p.id ? t.asking : t.askAi}</button> <span className="text-mute">{t.aiNote}</span></p>
                )}
              </div>
            )}
            {!out && m && p.map && p.read && (
              <>
                <div className="mt-3 overflow-x-auto">
                  <table className="text-sm" data-testid="intake-map">
                    <thead><tr className="text-mute"><th className="pe-4 text-start font-normal">{t.column}</th><th className="text-start font-normal">{t.field}</th></tr></thead>
                    <tbody>{heads.map((h, col) => h ? (
                      <tr key={col}>
                        <td className="pe-4">{h}</td>
                        <td><select className="rounded border border-line px-1 py-0.5" aria-label={`${t.field}: ${h}`} value={Object.entries(p.map!.cols).find(([, v]) => v === col)?.[0] ?? ""}
                          onChange={(e) => set(p.id, { override: { ...Object.fromEntries(Object.entries(p.map!.cols).map(([k, v]) => [v, k])), ...c.override, [col]: e.target.value || null } })}>
                          <option value="">{p.map!.unmapped.find((u) => u.col === col)?.why === "repeat" ? t.repeat : t.notUsed}</option>
                          {m.fields.map((fd) => <option key={fd.key} value={fd.key}>{lang === "ar" ? fd.label.ar : fd.label.en}</option>)}
                        </select></td>
                      </tr>) : null)}</tbody>
                  </table>
                </div>
                {p.map.missing.length > 0 && <p className="mt-2 text-sm text-red" data-testid="intake-missing">{t.missing(p.map.missing.join(", "))}</p>}
                {(m.key === "ar_open" || m.key === "ap_open") && (
                  <label className="mt-3 block text-sm">{t.asOf} <input type="date" className="ms-2 rounded border border-line px-2 py-1" data-testid="intake-asof" value={c.asOf ?? p.aged?.asOf ?? ""} onChange={(e) => set(p.id, { asOf: e.target.value || undefined })} />
                    {p.needs?.includes("as-of day") && <span className="ms-2 text-red">{t.asOfNeeded}</span>}</label>
                )}
                <p className="mt-3 text-sm" data-testid="intake-rows">{t.rows(p.read.records.length, p.read.rejected.length, p.read.skipped.length)}</p>
                <p className={cn("text-sm", p.read.proof.ok ? "text-green-d" : "text-red")} data-testid="intake-proof">
                  {p.read.proof.ok ? t.proofOk(p.read.proof.amountIn) : t.proofOff(p.read.proof.amountIn, p.read.proof.amountOut, p.read.proof.amountRejected)}
                  {p.read.proof.fileTotal && !p.read.proof.fileTotal.ok && <> {t.fileTotal(p.read.proof.fileTotal.stated, p.read.proof.fileTotal.read)}</>}
                </p>
                {!p.read.proof.ok && <label className="mt-1 block text-sm"><input type="checkbox" className="me-2" checked={!!c.anyway} onChange={(e) => set(p.id, { anyway: e.target.checked })} />{t.saveAnyway}</label>}
                {p.read.rejected.length > 0 && (
                  <details className="mt-2 text-sm" data-testid="intake-rejected">
                    <summary className="cursor-pointer">{t.rejected} ({p.read.rejected.length})</summary>
                    <ul className="mt-1 max-h-48 overflow-y-auto">{p.read.rejected.slice(0, 200).map((r) => <li key={r.row}>{t.rowN(r.row)}: {r.reason}</li>)}</ul>
                    <button type="button" className="mt-2 rounded border border-line px-3 py-1" onClick={() => void download(`${p.sheet} – rows not kept.xlsx`, [{ name: "Rows not kept", rows: [["Row", "Why", ...heads], ...p.read!.rejected.map((r) => [r.row, r.reason, ...r.cells])] }])}>{t.downloadRejected}</button>
                  </details>
                )}
              </>
            )}
          </section>
        );
      })}
      {(base0?.left.length ?? 0) > 0 && (
        <section className="mb-5" data-testid="intake-left">
          <h3 className="mb-1 font-semibold">{t.leftOut}</h3>
          <ul className="text-sm text-mute">{base0!.left.map((l) => <li key={l.sheet}>{l.sheet}: {l.reason}</li>)}</ul>
        </section>
      )}
      <section className="mb-6" data-testid="intake-checks">
        <h3 className="mb-1 font-semibold">{t.checks}</h3>
        {checks.length ? (
          <ul className="space-y-1 text-sm">{checks.map((x, i) => (
            <li key={i} className={x.status === "off" ? "text-red" : ""} data-testid="intake-check" data-status={x.status}><strong>{x.label}</strong>: {x.detail}{x.items.length > 0 && <ul className="ms-4 list-disc">{x.items.slice(0, 10).map((it) => <li key={it}>{it}</li>)}</ul>}</li>
          ))}</ul>
        ) : <p className="text-sm text-mute">{t.noChecks}</p>}
      </section>
      {err && <p className="mb-3 text-red" role="alert">{err}</p>}
      {blocked && <p className="mb-3 text-sm text-ink" data-testid="intake-blocked">{t.blocked}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="rounded-md border border-line px-4 py-2" onClick={() => { setGrids(null); setPhase("upload"); }}>{t.back}</button>
        <button type="button" className="rounded-md bg-brand-d px-6 py-2 font-medium text-white disabled:opacity-50" data-testid="intake-next" disabled={blocked || !included.length} onClick={() => setPhase("preview")}>{t.next}</button>
      </div>
    </div>
  );
}
