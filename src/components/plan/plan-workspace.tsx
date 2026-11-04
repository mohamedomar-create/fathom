"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BriefcaseBusiness, Check, Copy, FilePlus2, FileSpreadsheet, FileText, Landmark, LayoutDashboard, SlidersHorizontal, Trash2, TrendingUp, Wallet } from "lucide-react";
import { cn } from "@/lib/cn";
import { byYear, cleanPlan, planChecks, projectMonths, shortenPlan, type BusinessPlan, type PlanLabels, type ScenarioName, type SeedBasis } from "@/lib/engine/plan";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CostsTab, FundingTab, SalesTab, type SetPlan } from "./plan-inputs";
import { Overview, ScenariosTab, StatementsTab } from "./plan-views";
import { ReportTab } from "./plan-report";
import { cm, usePlanT } from "./plan-ui";

type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
/** Where plans are kept: the company's server actions, or the demo's memory. */
export interface PlanStore {
  create: (input: unknown) => Promise<Result<BusinessPlan>>;
  /** Saves if nobody saved since `expected` (the version it was edited from); returns the new version. */
  save: (id: string, plan: BusinessPlan, expected: string | null) => Promise<Result<string>>;
  remove: (id: string) => Promise<Result>;
}

const TABS = [
  { id: "overview", label: "Overview", icon: LayoutDashboard }, { id: "sales", label: "Sales", icon: TrendingUp }, { id: "costs", label: "Costs", icon: Wallet },
  { id: "funding", label: "Funding", icon: Landmark }, { id: "statements", label: "Statements", icon: FileSpreadsheet },
  { id: "scenarios", label: "Scenarios & risks", icon: SlidersHorizontal }, { id: "report", label: "Report", icon: FileText },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function PlanWorkspace({ initial, store, seed, cur, company, readOnly, note }: {
  initial: BusinessPlan[]; store: PlanStore; seed: (startYear: number, labels: PlanLabels) => Record<string, unknown> | null; cur: string; company: string; readOnly: boolean; note?: React.ReactNode;
}) {
  const { t, lang } = usePlanT();
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  const [list, setList] = useState(initial);
  const tab = (TABS.some((x) => x.id === params.get("tab")) ? params.get("tab") : "overview") as Tab;
  const saved = list.find((x) => x.id === params.get("plan")) ?? list.at(-1) ?? null;
  // Unsaved edits per plan: switching plans or a failed save never drops them.
  const [drafts, setDrafts] = useState<Record<string, BusinessPlan>>({});
  const sentRef = useRef<Record<string, string>>({});
  // The edit a save failed on: not retried by itself (no loop); the next change or leaving the page tries again.
  const failedRef = useRef<Record<string, string>>({});
  const inflight = useRef<Set<string>>(new Set());
  // Plans being deleted (or deleted): no save goes out for them, and a save already on its way is not reported.
  const gone = useRef<Set<string>>(new Set());
  const version = useRef<Record<string, string>>(Object.fromEntries(initial.map((x) => [x.id, x.updatedAt])));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  // Shown after a plan is started from part of a year's books: those months were scaled up to twelve.
  const [seedNote, setSeedNote] = useState("");
  const [sc, setSc] = useState<ScenarioName>("base");
  const [opened, setOpened] = useState<BusinessPlan | null>(null);
  if (saved && opened?.id !== saved.id) setOpened(saved);
  const p = (saved && drafts[saved.id]) || saved;
  const dirty = (id: string) => { const j = drafts[id] && JSON.stringify(drafts[id]); return !!j && j !== sentRef.current[id] && j !== failedRef.current[id]; };
  const pending = Boolean(saved && dirty(saved.id));

  // Saved by itself a second after the last change, when leaving the page, and before switching plans. One save at a
  // time per plan, each naming the version it was edited from; a failed save keeps the edits and says so.
  const flush = useRef<() => void>(() => undefined);
  useEffect(() => {
    flush.current = () => {
      if (readOnly) return;
      for (const [id, d] of Object.entries(drafts)) {
        const json = JSON.stringify(d);
        if (gone.current.has(id) || json === sentRef.current[id] || json === failedRef.current[id] || inflight.current.has(id)) continue;
        sentRef.current[id] = json;
        inflight.current.add(id);
        setState("saving");
        void store.save(id, d, version.current[id] ?? null).then((r) => {
          inflight.current.delete(id);
          if (gone.current.has(id)) return;
          if (r.ok) {
            version.current[id] = r.data;
            setState("saved"); setError("");
            setList((l) => l.map((x) => (x.id === id ? { ...d, updatedAt: r.data } : x)));
            setDrafts((all) => { if (JSON.stringify(all[id]) !== json) { setTimeout(() => flush.current(), 0); return all; } const { [id]: _, ...rest } = all; void _; return rest; });
          } else { delete sentRef.current[id]; failedRef.current[id] = json; setState("failed"); setError(r.error); }
        }, (e: unknown) => {
          // A save that couldn't reach the server (offline, a deploy in between): keep the edit and say so.
          inflight.current.delete(id);
          if (gone.current.has(id)) return;
          delete sentRef.current[id]; failedRef.current[id] = json;
          setState("failed"); setError(e instanceof Error && e.message ? e.message : t("Check your connection and try again."));
        });
      }
    };
  });
  useEffect(() => {
    if (!pending) return;
    const h = setTimeout(() => flush.current(), 1000);
    return () => clearTimeout(h);
  }, [drafts, pending]);
  const unsaved = useRef(false);
  unsaved.current = Object.keys(drafts).length > 0 || state === "failed" || state === "saving";
  useEffect(() => {
    const away = (e: BeforeUnloadEvent) => { flush.current(); if (unsaved.current) e.preventDefault(); };
    window.addEventListener("beforeunload", away);
    return () => { window.removeEventListener("beforeunload", away); flush.current(); };
  }, []);

  const go = (next: { tab?: string; plan?: string }) => {
    const q = new URLSearchParams(params.toString());
    if (next.tab) q.set("tab", next.tab);
    if (next.plan) { flush.current(); q.set("plan", next.plan); }
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  };
  const set: SetPlan = (patch) => { if (p && !readOnly) setDrafts((all) => ({ ...all, [p.id]: { ...(all[p.id] ?? p), ...patch } })); };

  const checks = useMemo(() => (p ? planChecks(p, projectMonths(p)) : []), [p]);
  const y1 = useMemo(() => (p ? byYear(projectMonths(p))[0] : null), [p]);
  const dot = checks.some((c) => c.level === "critical") ? "bg-red" : checks.some((c) => c.level === "warning") ? "bg-amber" : null;
  const sub: Partial<Record<Tab, string>> = p && y1 ? {
    sales: cm(y1.revenue, cur), costs: cm(y1.cogs + y1.staff + y1.overheads, cur),
    funding: cm(p.loans.filter((l) => l.month > 0).reduce((s, l) => s + l.amount, 0) + p.equity.reduce((s, e) => s + e.amount, 0), cur),
  } : {};

  const create = async (o: { name?: string; startYear: number; years: number; fromBooks: boolean; copyOf?: BusinessPlan }) => {
    const labels: PlanLabels = { loans: t("Existing loans"), other: t("Other sales"), overheads: t("Overheads"), lang };
    const { basis, ...seeded } = (!o.copyOf && o.fromBooks ? seed(o.startYear, labels) ?? {} : {}) as Record<string, unknown> & { basis?: SeedBasis | null };
    const base = o.copyOf ? { ...o.copyOf, name: `${o.copyOf.name} (${t("copy")})` } : { name: o.name || t("Business plan {from}–{to}", { from: o.startYear, to: o.startYear + o.years - 1 }), startYear: o.startYear, years: o.years, ...seeded };
    const r = await store.create(base);
    if (!r.ok) { setError(r.error); setState("failed"); return; }
    setSeedNote(basis && basis.months < 12 ? t("Started from {n} months of {year} ({from} to {to}), scaled up to a full year. Check the sales and costs before you rely on it.", { n: basis.months, year: basis.year, from: basis.first, to: basis.last }) : "");
    version.current[r.data.id] = r.data.updatedAt;
    setList((l) => [...l, r.data]); setStarting(false); setError(""); setState("idle");
    go({ plan: r.data.id, tab: "overview" });
  };

  if (!p || starting) return <StartScreen onCreate={create} canCancel={!!p} onCancel={() => setStarting(false)} readOnly={readOnly} error={error} note={note} />;
  const idx = TABS.findIndex((x) => x.id === tab);
  return (
    <div className="pb-10" data-testid="plan-workspace">
      <header className="-mx-4 mb-4 bg-band px-4 py-4 sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#0b6e70] to-[#0f8b8d] text-white" aria-hidden><BriefcaseBusiness className="h-5 w-5" /></span>
            <div className="min-w-0">
              <input aria-label={t("Plan name")} value={p.name} disabled={readOnly} maxLength={80} onChange={(e) => set({ name: e.target.value })} data-testid="plan-name"
                className="w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-xl font-semibold hover:border-line focus:border-brand focus:bg-white focus:outline-none disabled:opacity-100 sm:text-2xl" />
              <div className="mt-1 flex flex-wrap items-center gap-2 px-1 text-[13px] text-mute">
                <span>{t("From")}</span>
                <select aria-label={t("First year")} value={p.startYear} disabled={readOnly} onChange={(e) => set({ startYear: Number(e.target.value) })} className="rounded border border-line bg-white px-1.5 py-0.5">
                  {Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - 4 + i).map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <select aria-label={t("Years")} value={p.years} disabled={readOnly} onChange={(e) => set(shortenPlan(p, Number(e.target.value)))} className="rounded border border-line bg-white px-1.5 py-0.5" data-testid="plan-years">
                  {[3, 4, 5].map((n) => <option key={n} value={n}>{t("{n} years", { n })}</option>)}
                </select>
                <span>{p.startYear}–{p.startYear + p.years - 1}</span>
                {!readOnly && <span aria-live="polite" data-testid="plan-save-state" className={cn(state === "failed" && "text-red")}>
                  {state === "failed" && !pending ? `${t("Not saved")}: ${error}` : pending || state === "saving" ? t("Saving…") : state === "saved" ? <span className="inline-flex items-center gap-1 text-green-d"><Check className="h-3.5 w-3.5" aria-hidden />{t("All changes saved")}</span> : null}
                </span>}
                {readOnly && <span className="rounded bg-white px-2 py-0.5">{t("View only")}</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {list.length > 1 && <select aria-label={t("Plan")} value={p.id} onChange={(e) => go({ plan: e.target.value })} className="rounded border border-line bg-white px-2 py-1.5 text-[13px]" data-testid="plan-picker">
              {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>}
            {!readOnly && <>
              <button type="button" onClick={() => setStarting(true)} className="inline-flex items-center gap-1 rounded border border-line bg-white px-2.5 py-1.5 text-[13px] hover:border-brand" data-testid="plan-new"><FilePlus2 className="h-4 w-4" />{t("New plan")}</button>
              <button type="button" onClick={() => create({ startYear: p.startYear, years: p.years, fromBooks: false, copyOf: p })} className="inline-flex items-center gap-1 rounded border border-line bg-white px-2.5 py-1.5 text-[13px] hover:border-brand"><Copy className="h-4 w-4" />{t("Make a copy")}</button>
              <ConfirmDialog title={t("Delete this business plan?")} confirmLabel={t("Delete")} testId="plan-delete"
                trigger={<button type="button" className="inline-flex items-center gap-1 rounded border border-line bg-white px-2.5 py-1.5 text-[13px] text-red hover:border-red"><Trash2 className="h-4 w-4" />{t("Delete")}</button>}
                onConfirm={async () => { const id = p.id; gone.current.add(id); const r = await store.remove(id); if (!r.ok) { gone.current.delete(id); setTimeout(() => flush.current(), 0); return r.error; } delete sentRef.current[id]; delete failedRef.current[id]; setDrafts(({ [p.id]: _, ...rest }) => { void _; return rest; }); setState("idle"); setError(""); setList((l) => l.filter((x) => x.id !== p.id)); const q = new URLSearchParams(params.toString()); q.delete("plan"); router.replace(`${path}?${q.toString()}`); }}>
                <p className="text-sm text-mute">{t("“{name}” and everything in it are removed. This can’t be undone.", { name: p.name })}</p>
              </ConfirmDialog>
            </>}
          </div>
        </div>
        {note && <div className="mt-2 px-1 text-[12.5px] text-mute">{note}</div>}
      </header>
      {seedNote && (
        <div role="status" className="no-print mb-4 flex items-start gap-3 rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm" data-testid="plan-seed-note">
          <p className="flex-1">{seedNote}</p>
          <button type="button" onClick={() => setSeedNote("")} className="shrink-0 text-ink-2 underline">{t("Dismiss")}</button>
        </div>
      )}
      <nav aria-label={t("Plan sections")} className="no-print mb-4 overflow-x-auto">
        <ol className="flex min-w-max gap-1 rounded-xl border border-line bg-white p-1">
          {TABS.map((x, i) => (
            <li key={x.id}>
              <button type="button" onClick={() => go({ tab: x.id })} aria-current={tab === x.id ? "page" : undefined} data-testid={`plan-tab-${x.id}`}
                className={cn("relative flex items-center gap-2 rounded-lg px-3 py-1.5 text-start text-[13px]", tab === x.id ? "bg-brand-d text-white" : "text-ink-2 hover:bg-band")}>
                <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold", tab === x.id ? "bg-white/20" : "bg-band")}>{i + 1}</span>
                <span><span className="block font-medium leading-tight">{t(x.label)}</span>{sub[x.id] && <span className={cn("block text-[11px] leading-tight", tab === x.id ? "text-white" : "text-mute")}>{sub[x.id]}</span>}</span>
                {x.id === "overview" && dot && <span className={cn("absolute end-1 top-1 h-2 w-2 rounded-full", dot)} aria-label={t("The plan check found problems")} role="img" />}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      {tab === "overview" && <Overview p={p} set={set} sc={sc} setSc={setSc} cur={cur} readOnly={readOnly} go={(x) => go({ tab: x })} />}
      {tab === "sales" && <SalesTab p={p} set={set} opened={opened ?? p} cur={cur} readOnly={readOnly} />}
      {tab === "costs" && <CostsTab p={p} set={set} opened={opened ?? p} cur={cur} readOnly={readOnly} />}
      {tab === "funding" && <FundingTab p={p} set={set} opened={opened ?? p} cur={cur} readOnly={readOnly} />}
      {tab === "statements" && <StatementsTab p={p} sc={sc} setSc={setSc} cur={cur} />}
      {tab === "scenarios" && <ScenariosTab p={p} set={set} cur={cur} readOnly={readOnly} />}
      {tab === "report" && <ReportTab p={p} set={set} cur={cur} company={company} readOnly={readOnly} />}
      <div className="no-print mt-6 flex items-center justify-between">
        {idx > 0 ? <button type="button" onClick={() => go({ tab: TABS[idx - 1].id })} className="rounded border border-line bg-white px-3 py-1.5 text-[13px]"><span aria-hidden className="inline-block rtl:-scale-x-100">←</span> {t("Back")}</button> : <span />}
        {idx < TABS.length - 1 && <button type="button" onClick={() => go({ tab: TABS[idx + 1].id })} className="rounded bg-brand-d px-3 py-1.5 text-[13px] font-medium text-white" data-testid="plan-next">{t("Next: {tab}", { tab: t(TABS[idx + 1].label) })} <span aria-hidden className="inline-block rtl:-scale-x-100">→</span></button>}
      </div>
    </div>
  );
}

function StartScreen({ onCreate, canCancel, onCancel, readOnly, error, note }: { onCreate: (o: { startYear: number; years: number; fromBooks: boolean }) => Promise<void>; canCancel: boolean; onCancel: () => void; readOnly: boolean; error: string; note?: React.ReactNode }) {
  const { t } = usePlanT();
  const [fromBooks, setFromBooks] = useState(true);
  const [startYear, setStartYear] = useState(new Date().getFullYear() + 1);
  const [years, setYears] = useState(5);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mx-auto max-w-3xl py-6" data-testid="plan-start">
      <div className="rounded-2xl bg-gradient-to-br from-[#0b3b3c] to-[#0b6e70] p-6 text-white sm:p-8">
        <h1 className="text-2xl font-semibold sm:text-3xl">{t("Build a business plan your bank will read")}</h1>
        <ul className="mt-3 space-y-1 text-[14px] opacity-95">
          {["Three statements that always agree, month by month", "Best and worst cases, NPV, IRR and payback", "A feasibility study ready to print"].map((x) => <li key={x} className="flex items-center gap-2"><Check className="h-4 w-4" aria-hidden />{t(x)}</li>)}
        </ul>
      </div>
      {readOnly ? <p className="mt-6 text-center text-mute">{t("No business plan yet. An editor or admin can start one.")}</p> : (
        <div className="mt-6 space-y-4 rounded-2xl border border-line bg-white p-5">
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">{t("Start from")}</legend>
            {[{ v: true, h: "From my books", s: "Last year's sales per product, its overheads, and the position at its end", tag: "Recommended" }, { v: false, h: "A blank page", s: "For a new company or a new project" }].map((o) => (
              <label key={String(o.v)} className={cn("cursor-pointer rounded-xl border-2 p-4", fromBooks === o.v ? "border-brand bg-brand-bg/40" : "border-line hover:border-brand/60")}>
                <input type="radio" name="from" className="sr-only" checked={fromBooks === o.v} onChange={() => setFromBooks(o.v)} />
                <span className="flex items-center gap-2 font-semibold">{t(o.h)}{o.tag && <span className="rounded-full bg-brand-d px-2 py-0.5 text-[11px] font-medium text-white">{t(o.tag)}</span>}</span>
                <span className="mt-1 block text-[13px] text-mute">{t(o.s)}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-[13px]"><span className="mb-1 block text-mute">{t("First year")}</span>
              <select value={startYear} onChange={(e) => setStartYear(Number(e.target.value))} className="rounded border border-line bg-white px-2 py-1.5">{Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - 1 + i).map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
            <div className="text-[13px]"><span className="mb-1 block text-mute">{t("Years")}</span>
              <div role="radiogroup" aria-label={t("Years")} className="inline-flex rounded-lg border border-line p-0.5">{[3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={years === n} onClick={() => setYears(n)} className={cn("rounded-md px-3 py-1", years === n ? "bg-brand-d text-white" : "text-mute")}>{n}</button>)}</div></div>
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); await onCreate({ startYear, years, fromBooks }); setBusy(false); }} className="ms-auto rounded bg-brand-d px-5 py-2 font-medium text-white disabled:opacity-60" data-testid="plan-create">{busy ? t("Creating…") : t("Create the plan")}</button>
            {canCancel && <button type="button" onClick={onCancel} className="rounded border border-line px-4 py-2 text-[13px]">{t("Cancel")}</button>}
          </div>
          {error && <p role="alert" className="text-sm text-red">{error}</p>}
          {note && <div className="text-[12.5px] text-mute">{note}</div>}
        </div>
      )}
    </div>
  );
}

/** A plan as the demo keeps it (memory only): the same checks as the server. */
export function demoStore(): PlanStore {
  let n = 0;
  return {
    create: async (input) => { try { return { ok: true, data: { ...cleanPlan(input), id: `demo_${++n}_${Date.now().toString(36)}`, createdBy: "demo", updatedAt: new Date().toISOString() } }; } catch (e) { return { ok: false, error: (e as Error).message }; } },
    save: async (_id, plan) => { try { cleanPlan(plan); return { ok: true, data: new Date().toISOString() }; } catch (e) { return { ok: false, error: (e as Error).message }; } },
    remove: async () => ({ ok: true, data: undefined }),
  };
}
