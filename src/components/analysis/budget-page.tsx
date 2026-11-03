"use client";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, Download, Lock, Plus, Target, Upload } from "lucide-react";
import { forecast, fyStartOf, hasPL, money, pct, plCalc, PL_KEYS, type ClassKey, type PLInput } from "@/lib/engine";
import {
  budgetAccounts, budgetComparison, fyMonths, productVariance, seedFromForecast, seedFromLastYear, seedWithProducts, varianceRows,
  type BudgetLine, type BudgetProduct,
} from "@/lib/engine/budget";
import { accountMarkKey } from "@/lib/engine/statement-rows";
import type { SalesCustomerRow, SalesProductRow } from "@/lib/engine/sales";
import type { ExpenseAccountRow } from "@/lib/engine/expenses";
import type { BudgetSetup } from "@/lib/engine/budget-builder";
import type { BudgetVersionInfo } from "@/lib/company/budget-load";
import { useCompany } from "@/lib/company/context";
import { approveBudget, createBudget, deleteBudget, saveBudget } from "@/app/company/[id]/analysis/budget-actions";
import { PageHeader } from "@/components/shell/page-header";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "./common";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/use-t";

const PLS = new Set<string>(PL_KEYS);
const INCOME = new Set<string>(["revenue", "other_income", "interest_income"]);

/** A difference against budget: income above it and costs below it are better (green), the other way worse (red). */
function VarCell({ income, cur, cmp, text }: { income: boolean; cur: number; cmp: number; text: string }) {
  const { d } = useT();
  const diff = cur - cmp;
  const tone = Math.abs(diff) < 1 ? "neutral" : (income ? diff > 0 : diff < 0) ? "better" : "worse";
  return (
    <td className={cn(tone !== "neutral" && `tone-${tone}`)} data-tone={tone}>
      {diff !== 0 && <span aria-hidden className="me-1 text-[10px]">{diff > 0 ? "▲" : "▼"}</span>}{text}
      {tone !== "neutral" && <span className="sr-only"> ({tone === "better" ? d.hl.better : d.hl.worse})</span>}
    </td>
  );
}
const cellKey = (k: string, m: string) => `${k}\u0001${m}`;
/** The day the books stop on, when that is inside month `m` (a part month); else undefined. */
const partDayOf = (asOf: string | null | undefined, m: string) => (asOf && asOf.startsWith(m) ? Number(asOf.slice(8)) : undefined);

export interface BudgetPageProps {
  versions: BudgetVersionInfo[];
  current: { id: string; lines: BudgetLine[]; products: BudgetProduct[] } | null;
  /** Last year's and this year's sales by product and month (for seeding and the volume/price split). */
  salesProducts: SalesProductRow[];
  demo?: boolean;
  /** For the builder (not used yet): the company's setup, sales customers, expense accounts and financial-year start month. */
  setup?: BudgetSetup | null;
  salesCustomers?: SalesCustomerRow[];
  expenseAccounts?: ExpenseAccountRow[];
  fyStart?: number;
}

export function BudgetPage({ versions, current, salesProducts, demo }: BudgetPageProps) {
  const c = useCompany();
  const router = useRouter();
  const { lang, d, ml, ms } = useT();
  const t = d.bud;
  const clsName = d.setx.coa.cls as Record<string, string>;
  const cur = c.settings.currency;
  const fyStart = c.settings.fyStartMonth ?? 1;
  const version = versions.find((v) => v.id === current?.id) ?? null;
  const months = useMemo(() => (version ? fyMonths(version.fy, fyStart) : []), [version, fyStart]);
  const canEdit = !demo && !c.readOnly && version?.status === "draft";
  const canApprove = !demo && (c.role === "admin" || c.role === "owner") && version?.status === "draft";
  const [tab, setTab] = useState<"vs" | "accounts" | "products">("vs");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  // The edits not yet saved: account × month → amount, and product rows.
  // Edits belong to the figures they were made on: once a save brings new figures (a new `current`), they are dropped.
  type Draft = { base: BudgetPageProps["current"]; edits: Record<string, number>; extra: { key: string; cls: ClassKey; label: string }[]; prod: BudgetProduct[] | null };
  const [draft, setDraft] = useState<Draft>({ base: current, edits: {}, extra: [], prod: null });
  const live: Draft = draft.base === current ? draft : { base: current, edits: {}, extra: [], prod: null };
  const { edits, extra } = live;
  const prodEdits = live.prod;
  const change = (f: (d: Draft) => Partial<Draft>) => setDraft((d) => { const cur0 = d.base === current ? d : { base: current, edits: {}, extra: [], prod: null }; return { ...cur0, ...f(cur0) }; });
  const setEdits = (f: (e: Record<string, number>) => Record<string, number>) => change((d) => ({ edits: f(d.edits) }));
  const setExtra = (f: (e: Draft["extra"]) => Draft["extra"]) => change((d) => ({ extra: f(d.extra) }));
  const setProdEdits = (p: BudgetProduct[]) => change(() => ({ prod: p }));
  const lines = useMemo(() => {
    const m = new Map((current?.lines ?? []).map((l) => [cellKey(l.key, l.month), { ...l }]));
    const labels = new Map([...(current?.lines ?? []).map((l) => [l.key, { cls: l.cls, label: l.label }] as const), ...extra.map((x) => [x.key, { cls: x.cls, label: x.label }] as const)]);
    for (const [ck, v] of Object.entries(edits)) {
      const [key, month] = ck.split("\u0001");
      const info = labels.get(key);
      if (!info) continue;
      m.set(ck, { key, month, amount: v, cls: info.cls, label: info.label });
    }
    return [...m.values()].filter((l) => l.amount !== 0);
  }, [current, edits, extra]);
  const products = useMemo(() => prodEdits ?? current?.products ?? [], [prodEdits, current]);
  const dirty = Object.keys(edits).length + (prodEdits ? 1 : 0);

  const { accounts: budget, notes } = useMemo(() => budgetAccounts(lines, products), [lines, products]);
  const lastActual = c.months.filter(hasPL).map((m) => m.period).filter((p) => months.includes(p)).pop() ?? null;
  const [end, setEnd] = useState<string | null>(null);
  const upTo = end && months.includes(end) ? end : lastActual;
  const rows = useMemo(() => (upTo ? varianceRows(c.accounts, budget, months, upTo, partDayOf(c.asOf, upTo)) : [])
    .sort((a, b) => PL_KEYS.indexOf(a.cls as never) - PL_KEYS.indexOf(b.cls as never) || a.label.localeCompare(b.label)), [c.accounts, budget, months, upTo, c.asOf]);
  const pv = useMemo(() => (upTo ? productVariance(products, salesProducts, months.filter((m) => m <= upTo)) : []), [products, salesProducts, months, upTo]);
  const fmt = (v: number) => money(v, cur, true);

  // Net profit year to date: actual against budget, through the same statements.
  const head = useMemo(() => {
    if (!upTo) return null;
    const b = budgetComparison(budget, { type: "year", end: upTo }, fyStart, version?.name ?? "", partDayOf(c.asOf, upTo)).P;
    const ytd = months.filter((m) => m <= upTo);
    const pl: PLInput = {};
    for (const a of c.accounts) if (PLS.has(a.cls)) for (const m of ytd) pl[a.cls as keyof PLInput] = (pl[a.cls as keyof PLInput] ?? 0) + (a.amounts[m] ?? 0);
    const a = plCalc(pl);
    return { a: a.net_income, b: b.net_income };
  }, [budget, upTo, fyStart, version, months, c.accounts, c.asOf]);

  const go = (id: string) => router.push(`?v=${id}`);
  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  async function saveEdits() {
    if (!version) return;
    start(async () => {
      const changed = Object.entries(edits).map(([ck, v]) => {
        const [key, month] = ck.split("\u0001");
        const l = lines.find((x) => x.key === key && x.month === month);
        const x = extra.find((e) => e.key === key);
        const old = current?.lines.find((o) => o.key === key);
        return { key, month, amount: v, cls: (l?.cls ?? x?.cls ?? old?.cls)!, label: l?.label ?? x?.label ?? old?.label ?? null };
      });
      // A cleared cell is saved as 0 (a budget of nothing that month).
      // One call: the lines and the products are saved together or not at all.
      const r = await saveBudget(c.id, version.id, { lines: changed, products: prodEdits, replaceLines: false });
      if (!r.ok) return say(false, r.error);
      say(true, t.saved);
      router.refresh();
    });
  }

  async function uploadTemplate(f: File) {
    if (!version) return;
    const [{ readWorkbook }, { readBudgetGrids }] = await Promise.all([import("@/lib/ingest/read"), import("@/lib/budget/template")]);
    const r = readBudgetGrids(await readWorkbook(await f.arrayBuffer(), f.name), months);
    if (r.errors.length) return say(false, r.errors.slice(0, 5).join(" "));
    start(async () => {
      // Only the parts the file holds are replaced: a file without the Products sheet leaves the products as they are.
      const res = await saveBudget(c.id, version.id, { lines: r.hasLines ? r.lines : null, products: r.hasProducts ? r.products : null, replaceLines: true });
      if (!res.ok) return say(false, res.error);
      say(true, t.read(r.lines.length, r.products.length));
      router.refresh();
    });
  }

  async function downloadTemplate() {
    const { buildBudgetWorkbook } = await import("@/lib/budget/template");
    const keys = new Set(lines.map((l) => l.key));
    const accts = c.accounts.filter((a) => PLS.has(a.cls) && !keys.has(accountMarkKey(a))).map((a) => ({ key: accountMarkKey(a), cls: a.cls, label: a.code ? `${a.code} ${a.name}` : a.name }));
    const buf = await buildBudgetWorkbook({ lines, products, months, accounts: accts });
    const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url; a.download = `budget-${version?.fy ?? ""}.xlsx`; a.click();
    URL.revokeObjectURL(url);
  }

  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      <PageHeader title={t.title} right={!demo && !c.readOnly ? <NewBudget versions={versions} salesProducts={salesProducts} onCreated={go} say={say} /> : undefined}>
        <p className="text-sm text-mute">{t.intro}</p>
      </PageHeader>
      {demo && <p className="mb-4 rounded bg-band px-3 py-2 text-sm" data-testid="budget-demo">{t.demo}</p>}
      {!version ? (
        <EmptyState icon={<Target className="h-6 w-6" />} title={t.none} text={t.noneText} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="budget-bar">
            <label className="sr-only" htmlFor="budget-version">{t.version}</label>
            <select id="budget-version" className="min-w-0 max-w-[18rem] rounded border border-line bg-white px-2 py-1.5 text-sm" value={version.id} onChange={(e) => go(e.target.value)} data-testid="budget-version">
              {versions.map((v) => <option key={v.id} value={v.id}>{`${v.name} · ${t.status[v.status]}`}</option>)}
            </select>
            <span className={cn("rounded px-2 py-0.5 text-xs font-medium", version.status === "approved" ? "bg-green-50 text-green-d" : "bg-band text-mute")} data-testid="budget-status">
              {version.status === "approved" ? <Lock aria-hidden className="me-1 inline h-3 w-3" /> : null}{t.kind[version.kind]} · {t.status[version.status]}
            </span>
            {version.approvedAt && <span className="text-xs text-mute">{t.approvedOn(version.approvedAt.slice(0, 10))}</span>}
            <div className="ms-auto flex flex-wrap gap-2">
              <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1 rounded border border-line px-3 py-1.5 text-sm" data-testid="budget-download"><Download aria-hidden className="h-4 w-4" />{t.download}</button>
              {canEdit && <>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" className="sr-only" aria-label={t.upload} data-testid="budget-upload-input" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadTemplate(f); e.target.value = ""; }} />
                <button type="button" onClick={() => fileRef.current?.click()} title={t.uploadText} className="inline-flex items-center gap-1 rounded border border-line px-3 py-1.5 text-sm" data-testid="budget-upload"><Upload aria-hidden className="h-4 w-4" />{t.upload}</button>
                <ConfirmDialog testId="budget-delete" trigger={<button type="button" className="rounded border border-line px-3 py-1.5 text-sm text-red-d">{t.del}</button>} title={t.delTitle} confirmLabel={t.del}
                  onConfirm={async () => { const r = await deleteBudget(c.id, version.id); if (!r.ok) return r.error; router.push("?"); router.refresh(); }}>{t.delText}</ConfirmDialog>
              </>}
              {canApprove && (
                <ConfirmDialog testId="budget-approve" trigger={<button type="button" className="inline-flex items-center gap-1 rounded bg-brand-d px-3 py-1.5 text-sm font-medium text-white"><CheckCircle2 aria-hidden className="h-4 w-4" />{t.approve}</button>} title={t.approveTitle} confirmLabel={t.approve}
                  onConfirm={async () => { if (dirty) return t.unsaved(dirty); const r = await approveBudget(c.id, version.id); if (!r.ok) return r.error; router.refresh(); }}>{t.approveText}</ConfirmDialog>
              )}
            </div>
          </div>
          {version.status === "approved" && <p className="mb-3 text-sm text-mute">{t.locked}</p>}
          {msg && <p role="status" className={cn("mb-3 text-sm", msg.ok ? "text-green-d" : "text-red-d")} data-testid="budget-msg">{msg.text}</p>}
          <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
            {(["vs", "accounts", "products"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)} data-testid={`budget-tab-${k}`}
                className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === k ? "border-brand-d font-medium" : "border-transparent text-mute")}>{t.tabs[k]}</button>
            ))}
          </div>

          {tab === "vs" && (
            !upTo ? <p className="text-sm text-mute" data-testid="budget-no-actual">{t.noActual}</p> : (
              <div data-testid="budget-vs">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <label htmlFor="budget-upto">{t.upTo}</label>
                  <select id="budget-upto" className="rounded border border-line bg-white px-2 py-1" value={upTo} onChange={(e) => setEnd(e.target.value)}>
                    {months.filter((m) => !lastActual || m <= lastActual).map((m) => <option key={m} value={m}>{ml(m)}</option>)}
                  </select>
                </div>
                {head && head.b !== 0 && (
                  <p className="mb-3 text-lg" data-testid="budget-headline">
                    {t.headline(pct(Math.abs(((head.a - head.b) / Math.abs(head.b)) * 100), 1), head.a >= head.b ? t.above : t.below)}
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="tbl text-[13px]">
                    <thead>
                      <tr><th>{t.account}</th><th>{t.monthCol} · {t.actual}</th><th>{t.budget}</th><th>{t.diff}</th><th>{t.ytdCol} · {t.actual}</th><th>{t.budget}</th><th>{t.diff}</th><th>%</th><th title={t.outlookHint}>{t.outlook}</th><th>{t.fullYear}</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.key} data-testid="budget-vs-row" data-key={r.key} data-tone={r.tone}>
                          <td>{r.key.startsWith("class:") ? clsName[r.cls] : r.label}</td>
                          <td>{fmt(r.month.actual)}</td><td>{fmt(r.month.budget)}</td>
                          <VarCell income={INCOME.has(r.cls)} cur={r.month.actual} cmp={r.month.budget} text={fmt(r.month.diff)} />
                          <td>{fmt(r.ytd.actual)}</td><td>{fmt(r.ytd.budget)}</td>
                          <VarCell income={INCOME.has(r.cls)} cur={r.ytd.actual} cmp={r.ytd.budget} text={fmt(r.ytd.diff)} />
                          <VarCell income={INCOME.has(r.cls)} cur={r.ytd.actual} cmp={r.ytd.budget} text={r.ytd.pct === null ? "–" : pct(r.ytd.pct)} />
                          <td>{fmt(r.outlook)}</td><td>{fmt(r.fullYear)}</td>
                        </tr>
                      ))}
                      {head && <tr className="tot"><td>{t.profit}</td><td /><td /><td /><td>{fmt(head.a)}</td><td>{fmt(head.b)}</td><VarCell income cur={head.a} cmp={head.b} text={fmt(head.a - head.b)} /><VarCell income cur={head.a} cmp={head.b} text={head.b ? pct(((head.a - head.b) / Math.abs(head.b)) * 100) : "–"} /><td /><td /></tr>}
                    </tbody>
                  </table>
                </div>
                {pv.length > 0 && (
                  <section className="mt-6" data-testid="budget-pv">
                    <h2 className="mb-1 text-lg font-light">{t.productsVs}</h2>
                    <p className="mb-2 text-xs text-mute">{t.volumeHint}</p>
                    <div className="overflow-x-auto">
                      <table className="tbl text-[13px]">
                        <thead><tr><th>{t.product}</th><th>{t.units} · {t.budget}</th><th>{t.units} · {t.actual}</th><th>{t.budget}</th><th>{t.actual}</th><th>{t.volume}</th><th>{t.priceEff}</th></tr></thead>
                        <tbody>
                          {pv.slice(0, 50).map((p) => (
                            <tr key={p.product}><td>{p.product}</td><td>{p.budgetUnits.toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</td><td>{p.actualUnits === null ? "–" : p.actualUnits.toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</td>
                              <td>{fmt(p.budget)}</td><td>{fmt(p.actual)}</td><td>{p.volume === null ? t.unexplained : fmt(p.volume)}</td><td>{p.price === null ? "–" : fmt(p.price)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>
            )
          )}

          {tab === "accounts" && (
            <AccountsGrid key={`${version.id}:${version.updatedAt}`} lines={lines} months={months} edit={canEdit} clsName={clsName} ms={ms} fmt={fmt} productMonths={new Set(products.map((p) => p.month))}
              onCell={(k, m, v) => setEdits((e) => ({ ...e, [cellKey(k, m)]: v }))}
              addable={canEdit ? c.accounts.filter((a) => PLS.has(a.cls) && !lines.some((l) => l.key === accountMarkKey(a)) && !extra.some((x) => x.key === accountMarkKey(a))) : []}
              onAdd={(a) => setExtra((x) => [...x, { key: accountMarkKey(a), cls: a.cls, label: a.code ? `${a.code} ${a.name}` : a.name }])}
              extra={extra} notes={notes} fromProducts={budget.filter((a) => a.id.startsWith("prod:"))} />
          )}
          {tab === "products" && <ProductsGrid key={`${version.id}:${version.updatedAt}`} rows={products} months={months} edit={canEdit} onChange={setProdEdits} fmt={fmt} ml={ml} />}

          {canEdit && dirty > 0 && (
            <div className="sticky bottom-16 mt-4 flex items-center gap-3 rounded border border-line bg-white p-3 shadow md:bottom-2">
              <span className="text-sm text-mute">{t.unsaved(dirty)}</span>
              <button type="button" disabled={pending} onClick={saveEdits} className="ms-auto rounded bg-brand-d px-4 py-2 text-sm font-medium text-white disabled:opacity-50" data-testid="budget-save">{t.save}</button>
            </div>
          )}
        </>
      )}
    </div>
  );

}

function NewBudget({ versions, salesProducts, onCreated, say }: { versions: BudgetVersionInfo[]; salesProducts: SalesProductRow[]; onCreated: (id: string) => void; say: (ok: boolean, text: string) => void }) {
  const c = useCompany();
  const { lang, d } = useT();
  const t = d.bud;
  const fyStart = c.settings.fyStartMonth ?? 1;
  const last = c.months.filter(hasPL).map((m) => m.period).pop();
  const thisFy = last ? fyStartOf(last, fyStart).slice(0, 4) : String(new Date().getFullYear());
  const years = [thisFy, String(Number(thisFy) + 1)];
  const [open, setOpen] = useState(false);
  const [fy, setFy] = useState(years[0]);
  const hasOriginal = versions.some((v) => v.fy === fy && v.kind === "original");
  const [name, setName] = useState("");
  const [from, setFrom] = useState<"ly" | "forecast" | "copy" | "blank">("ly");
  const [pctV, setPct] = useState("10");
  const [withProducts, setWithProducts] = useState(true);
  const sameYear = versions.filter((v) => v.fy === fy);
  const [copyId, setCopyId] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true); setErr(null);
    const ms12 = fyMonths(fy, fyStart);
    let seed: BudgetLine[] = [];
    let prods: BudgetProduct[] = [];
    let skipped: string[] = [];
    const p = Number(pctV) || 0;
    if (from === "ly") {
      seed = seedFromLastYear(c.accounts, ms12, p);
      if (!seed.length) { setBusy(false); return setErr(t.lyNone); }
      if (withProducts && salesProducts.length) ({ lines: seed, products: prods, skipped } = seedWithProducts(c.accounts, salesProducts, ms12, p));
    } else if (from === "forecast") {
      const f = forecast(c.months, c.settings, { horizon: 24 } as never, c.assumptions ?? {}, c.asOf, lang);
      seed = f.ok ? seedFromForecast(f.months, ms12) : [];
      if (!seed.length) { setBusy(false); return setErr(t.forecastNone); }
    }
    const copy = from === "copy" ? copyId || sameYear[0]?.id || null : null;
    const r = await createBudget(c.id, { fy, kind: hasOriginal ? "revision" : "original", name, from: copy });
    if (!r.ok) { setBusy(false); return setErr(r.error); }
    const saved = seed.length || prods.length ? await saveBudget(c.id, r.data, { lines: seed, products: prods.length ? prods : null, replaceLines: false }) : null;
    const e = saved && !saved.ok ? saved.error : null;
    setBusy(false);
    if (e) return setErr(e);
    setOpen(false);
    if (skipped.length) say(true, t.skipped(skipped.slice(0, 10).join(", ")));
    onCreated(r.data);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button type="button" className="inline-flex items-center gap-1 rounded bg-brand-d px-3 py-1.5 text-sm font-medium text-white" data-testid="budget-new"><Plus aria-hidden className="h-4 w-4" />{t.newBudget}</button></DialogTrigger>
      <DialogContent title={t.newBudget} className="w-[min(520px,calc(100vw-24px))] p-6">
        <h2 className="mb-4 text-xl font-light">{t.newBudget}</h2>
        <div className="grid gap-3 text-sm">
          <label className="grid gap-1">{t.year}
            <select className="rounded border border-line px-2 py-1.5" value={fy} onChange={(e) => setFy(e.target.value)} data-testid="budget-fy">{years.map((y) => <option key={y} value={y}>{t.fy(y)}</option>)}</select>
          </label>
          <p className="text-mute">{t.type}: <b>{t.kind[hasOriginal ? "revision" : "original"]}</b></p>
          <label className="grid gap-1">{t.name}<input className="rounded border border-line px-2 py-1.5" maxLength={80} placeholder={t.namePh} value={name} onChange={(e) => setName(e.target.value)} data-testid="budget-name" /></label>
          <fieldset className="grid gap-1"><legend className="mb-1">{t.from}</legend>
            {([["ly", t.fromLy], ["forecast", t.fromForecast], ...(sameYear.length ? [["copy", t.fromCopy]] : []), ["blank", t.fromBlank]] as [typeof from, string][]).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2"><input type="radio" name="budget-from" checked={from === k} onChange={() => setFrom(k)} data-testid={`budget-from-${k}`} />{label}</label>
            ))}
          </fieldset>
          {from === "ly" && <>
            <label className="grid gap-1">{t.pct}<input type="number" step="0.5" className="w-32 rounded border border-line px-2 py-1.5" value={pctV} onChange={(e) => setPct(e.target.value)} data-testid="budget-pct" /><span className="text-xs text-mute">{t.pctHint}</span></label>
            {salesProducts.length > 0 && <label className="flex items-center gap-2"><input type="checkbox" checked={withProducts} onChange={(e) => setWithProducts(e.target.checked)} />{t.withProducts}</label>}
          </>}
          {from === "copy" && (
            <label className="grid gap-1">{t.copyOf}<select className="rounded border border-line px-2 py-1.5" value={copyId || sameYear[0]?.id} onChange={(e) => setCopyId(e.target.value)}>{sameYear.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
          )}
          {err && <p role="alert" className="text-red-d" data-testid="budget-new-error">{err}</p>}
          <button type="button" disabled={busy} onClick={create} className="mt-2 rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50" data-testid="budget-create">{busy ? t.creating : t.create}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AccountsGrid({ lines, months, edit, clsName, ms, fmt, onCell, addable, onAdd, extra, notes, productMonths, fromProducts }: {
  lines: BudgetLine[]; months: string[]; edit: boolean; clsName: Record<string, string>; ms: (p: string) => string; fmt: (v: number) => string;
  onCell: (k: string, m: string, v: number) => void; addable: { code: string; name: string; cls: ClassKey; id: string }[];
  onAdd: (a: { code: string; name: string; cls: ClassKey; id: string; amounts: Record<string, number> }) => void;
  extra: { key: string; cls: ClassKey; label: string }[]; notes: string[]; productMonths: Set<string>;
  /** Revenue and cost of sales worked out from the products: shown, not edited here. */
  fromProducts: { id: string; cls: ClassKey; amounts: Record<string, number> }[];
}) {
  const { d } = useT();
  const t = d.bud;
  const byKey = new Map<string, { cls: ClassKey; label: string; v: Record<string, number> }>();
  for (const l of lines) {
    const r = byKey.get(l.key) ?? { cls: l.cls, label: l.label ?? (l.key.startsWith("cls:") ? clsName[l.cls] : l.key), v: {} };
    r.v[l.month] = l.amount;
    byKey.set(l.key, r);
  }
  for (const x of extra) if (!byKey.has(x.key)) byKey.set(x.key, { cls: x.cls, label: x.label, v: {} });
  for (const p of fromProducts) byKey.set(p.id, { cls: p.cls, label: `${clsName[p.cls]} · ${t.fromProducts}`, v: p.amounts });
  const groups = PL_KEYS.map((cls) => ({ cls, rows: [...byKey.entries()].filter(([, r]) => r.cls === cls) })).filter((g) => g.rows.length);
  return (
    <div data-testid="budget-accounts">
      {productMonths.size > 0 && <p className="mb-2 text-xs text-mute">{t.fromProductsNote}</p>}
      {notes.length > 0 && <ul className="mb-2 text-xs text-mute">{notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <div className="overflow-x-auto">
        <table className="tbl text-[13px]">
          <thead><tr><th>{t.account}</th>{months.map((m) => <th key={m}>{ms(m)}</th>)}<th>{t.total}</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.cls}>{Rows({ title: clsName[g.cls], rows: g.rows })}</Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {edit && addable.length > 0 && (
        <label className="mt-3 flex items-center gap-2 text-sm">{t.addAccount}
          <select className="min-w-0 max-w-[18rem] rounded border border-line bg-white px-2 py-1" value="" data-testid="budget-add-account"
            onChange={(e) => { const a = addable.find((x) => x.id === e.target.value); if (a) onAdd({ ...a, amounts: {} }); }}>
            <option value="">{t.choose}</option>
            {addable.map((a) => <option key={a.id} value={a.id}>{a.code ? `${a.code} ${a.name}` : a.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );

  function Rows({ title, rows }: { title: string; rows: [string, { cls: ClassKey; label: string; v: Record<string, number> }][] }) {
    return (
      <>
        <tr className="cat"><td colSpan={months.length + 2}>{title}</td></tr>
        {rows.map(([key, r]) => (
          <tr key={key} data-testid="budget-row" data-key={key}>
            <td>{r.label}</td>
            {months.map((m) => (
              <td key={m} className="p-0.5">
                {edit && !key.startsWith("prod:") ? (
                  <input inputMode="decimal" aria-label={`${r.label} ${m}`} className="w-24 rounded border border-transparent bg-transparent px-1 py-1 text-end hover:border-line focus:border-brand-d"
                    defaultValue={r.v[m] ?? ""} data-testid={`budget-cell-${key}-${m}`}
                    onBlur={(e) => { const raw = e.target.value.replace(/,/g, "").trim(); const n = raw === "" ? 0 : Number(raw); if (Number.isFinite(n) && n !== (r.v[m] ?? 0)) onCell(key, m, Math.round(n * 100) / 100); }} />
                ) : (r.v[m] ? fmt(r.v[m]) : "–")}
              </td>
            ))}
            <td className="font-medium">{fmt(months.reduce((s, m) => s + (r.v[m] ?? 0), 0))}</td>
          </tr>
        ))}
      </>
    );
  }
}

function ProductsGrid({ rows, months, edit, onChange, fmt, ml }: { rows: BudgetProduct[]; months: string[]; edit: boolean; onChange: (r: BudgetProduct[]) => void; fmt: (v: number) => string; ml: (p: string) => string }) {
  const { d } = useT();
  const t = d.bud;
  const [filter, setFilter] = useState("");
  const names = [...new Set(rows.map((r) => r.product))].sort();
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !filter || r.product === filter);
  const set = (i: number, patch: Partial<BudgetProduct>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const num = (v: string) => { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
  const [newName, setNewName] = useState("");
  return (
    <div data-testid="budget-products">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <select aria-label={t.product} className="min-w-0 max-w-[16rem] rounded border border-line bg-white px-2 py-1" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">{t.allProducts}</option>{names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {edit && <>
          <input className="min-w-0 rounded border border-line px-2 py-1" placeholder={t.productPh} value={newName} onChange={(e) => setNewName(e.target.value)} data-testid="budget-product-name" />
          <button type="button" className="inline-flex items-center gap-1 rounded border border-line px-2 py-1" data-testid="budget-product-add"
            onClick={() => { const n = newName.trim(); if (!n) return; onChange([...rows, ...months.map((m) => ({ product: n, category: null, month: m, units: 0, price: 0, unit_cost: null }))]); setNewName(""); setFilter(n); }}>
            <Plus aria-hidden className="h-4 w-4" />{t.addProduct}</button>
        </>}
      </div>
      <div className="overflow-x-auto">
        <table className="tbl text-[13px]">
          <thead><tr><th>{t.product}</th><th>{t.month}</th><th>{t.units}</th><th>{t.price}</th><th>{t.unitCost}</th><th>{t.revenue}</th><th>{t.cost}</th></tr></thead>
          <tbody>
            {shown.slice(0, 600).map(({ r, i }) => (
              <tr key={`${r.product}-${r.month}-${i}`} data-testid="budget-product-row">
                <td>{r.product}</td><td>{ml(r.month)}</td>
                {(["units", "price", "unit_cost"] as const).map((f) => (
                  <td key={f} className="p-0.5">{edit
                    ? <input inputMode="decimal" aria-label={`${r.product} ${r.month} ${f}`} className="w-20 rounded border border-transparent px-1 py-1 text-end hover:border-line" defaultValue={r[f] ?? ""}
                        data-testid={`budget-product-${f}`} onBlur={(e) => {
                          const v = f === "unit_cost" && e.target.value.trim() === "" ? null : num(e.target.value);
                          if (v !== r[f]) set(i, { [f]: v });
                        }} />
                    : r[f] === null ? "–" : r[f]!.toLocaleString("en-US")}</td>
                ))}
                <td>{fmt(r.units * r.price)}</td><td>{r.unit_cost === null ? "–" : fmt(r.units * r.unit_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {months.length === 0 && null}
    </div>
  );
}
