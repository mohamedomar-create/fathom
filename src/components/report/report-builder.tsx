"use client";
import { ArrowDown, ArrowUp, Copy, Download, Eye, EyeOff, Globe, Loader2, Printer, Save, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useMemo, useState, useTransition } from "react";
import { selectableEnds, stripMemoStamp, windowFor, type PeriodType } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useSales } from "@/lib/company/sales-context";
import { useExpenses } from "@/lib/company/expenses-context";
import { downloadReportPdf } from "@/lib/report/export";
import { COMMENTARY_SECTIONS } from "@/lib/ai/sections";
import { REPORT_SECTIONS, SECTION_COMMENT, type ReportInput, type ReportOrg, type ReportSection } from "@/lib/report/types";
import { demoBudget } from "@/lib/company/demo-budget";
import { demoSales } from "@/lib/company/demo-sales";
import { deleteReport, publishReport, saveCommentary, saveReport, updatePublishedFigures } from "@/app/company/[id]/reports/actions";
import { dateIn, ReportDocument, titleIn } from "./report-document";
import { titleToStore } from "@/lib/report/title";
import { useT } from "@/lib/i18n/use-t";
import { useMsg } from "@/lib/i18n/msg";
import { cn } from "@/lib/cn";

export interface ReportRecord { id: string; title: string; period_type: PeriodType; period_end: string; sections: ReportSection[]; status: string; share_token: string | null; expires_at?: string | null; frozen_at?: string | null }

export function ReportBuilder({ report, org, demo = false, budget: budgetIn }: { report: ReportRecord; org: ReportOrg; demo?: boolean; budget?: ReportInput["budget"] }) {
  const c = useCompany();
  const router = useRouter();
  const sales = useSales();
  const expenses = useExpenses();
  const T = useT();
  const t = T.d.rep.b;
  const m = useMsg();
  const [title, setTitle] = useState(() => titleIn(report.title, T));
  const [type, setType] = useState<PeriodType>(report.period_type);
  const [end, setEnd] = useState(report.period_end);
  const [sections, setSections] = useState<ReportSection[]>(report.sections);
  const [token, setToken] = useState<string | null>(report.share_token);
  const [expiresAt, setExpiresAt] = useState<string | null>(report.expires_at ?? null);
  const [expiry, setExpiry] = useState<0 | 30 | 90>(0);
  const [frozenAt, setFrozenAt] = useState<string | null>(report.frozen_at ?? null);
  const ends = useMemo(() => selectableEnds(c.months, type, c.settings.fyStartMonth), [c.months, type, c.settings.fyStartMonth]);
  const validEnd = ends.some((e) => e.end === end) ? end : ends[ends.length - 1]?.end ?? end;
  const periodKey = `${type}:${validEnd}`;
  const initialComments = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.commentary)) { const [pk, s] = k.split("|"); if (pk === periodKey && s) out[s] = v; else if (!s) out[k] = v; }
    return out;
  }, [c.commentary, periodKey]);
  // Unsaved edits are kept per period, so switching the period never carries text across.
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const comments = useMemo(() => ({ ...initialComments, ...edits[periodKey] }), [initialComments, edits, periodKey]);
  const setComments = (f: (x: Record<string, string>) => Record<string, string>) => setEdits((e) => ({ ...e, [periodKey]: f({ ...initialComments, ...e[periodKey] }) }));
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, start] = useTransition();
  const footer = org.footer || t.footer(c.name, T.pl(windowFor({ type, end: validEnd }, c.settings.fyStartMonth).label), org.name);

  // The demo shows its made-up approved budget; a company the budget it approved.
  const budget = useMemo<ReportInput["budget"]>(() => {
    if (budgetIn !== undefined) return budgetIn;
    if (!demo) return null;
    const b = demoBudget(c.accounts, c.months, c.settings.fyStartMonth, demoSales().products);
    return { name: b.name, lines: b.lines, products: b.products };
  }, [budgetIn, demo, c.accounts, c.months, c.settings.fyStartMonth]);
  const input = useMemo(() => ({
    title, companyName: c.name, months: c.months, accounts: c.accounts, settings: c.settings, alerts: c.alerts,
    sel: { type, end: validEnd }, sections, commentary: comments, org, notes: c.notes ?? [], accepted: c.accepted ?? [], assumptions: c.assumptions ?? {}, forecast: c.forecast ?? {}, sales, expenses, asOf: c.asOf ?? null, budget,
    preparedOn: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
  }), [title, c, type, validEnd, sections, comments, org, sales, expenses, budget]);
  const shortDate = (d: string, time = false) => dateIn(new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) }), T).replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\b/g, (x) => (T.lang === "ar" ? T.pl(x.slice(0, 3)) : x));

  const move = (i: number, d: -1 | 1) => setSections((s) => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const run = (key: string, f: () => Promise<void>) => { setBusy(key); setMsg(null); start(async () => { try { await f(); } catch (e) { setMsg({ ok: false, text: m((e as Error).message) }); } finally { setBusy(null); } }); };

  const save = () => run("save", async () => {
    const r = await saveReport({ id: report.id, title: titleToStore(title, T.d.rep.defaultTitle), period_type: type, period_end: validEnd, sections });
    setMsg(r.ok ? { ok: true, text: t.saved } : { ok: false, text: r.error ? m(r.error) : t.couldNotSave });
  });
  const ai = (section?: string) => run(section ? `ai:${section}` : "ai", async () => {
    // One request per section keeps each call well inside the server function time limit.
    const results = await Promise.allSettled((section ? [section] : COMMENTARY_SECTIONS.filter((k) => sections.some((x) => x.enabled && SECTION_COMMENT[x.key] === k))).map(async (s) => {
      const res = await fetch(`/api/companies/${c.id}/commentary`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, end: validEnd, sections: [s], lang: T.lang }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? t.aiFailed);
      return j.commentary as Record<string, string>;
    }));
    const written = Object.assign({}, ...results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])));
    setComments((x) => ({ ...x, ...written }));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed && !Object.keys(written).length) throw failed.reason;
    setMsg({ ok: !failed, text: t.aiWritten(Object.keys(written).length, failed ? m((failed.reason as Error).message) : null) });
  });
  const saveComment = (section: string) => run(`c:${section}`, async () => {
    if (demo) { setEditing(null); return; }
    const r = await saveCommentary(c.id, periodKey, section, comments[section] ?? "");
    if (!r.ok) throw new Error(r.error);
    setEditing(null);
  });
  const publish = (on: boolean) => run("pub", async () => {
    await saveReport({ id: report.id, title: titleToStore(title, T.d.rep.defaultTitle), period_type: type, period_end: validEnd, sections });
    const r = await publishReport(report.id, on, expiry);
    if (!r.ok) throw new Error(r.error);
    setToken(r.token ?? null);
    setExpiresAt(r.expiresAt ?? null);
    setFrozenAt(on ? r.frozenAt ?? null : null);
    setMsg({ ok: true, text: on ? t.published(expiry) : t.stopped });
  });
  // The server prints the saved report from its own figures: what is on screen is saved first.
  const pdf = () => run("pdf", async () => {
    if (demo) return downloadReportPdf({ title: `${c.name} - ${title}`, footer, demo });
    if (!c.readOnly) { const r = await saveReport({ id: report.id, title: titleToStore(title, T.d.rep.defaultTitle), period_type: type, period_end: validEnd, sections }); if (!r.ok) throw new Error(r.error ?? t.couldNotSave); }
    await downloadReportPdf({ title: `${c.name} - ${title}`, footer, companyId: c.id, reportId: report.id });
  });
  const shareUrl = token && typeof window !== "undefined" ? `${window.location.origin}/r/${token}` : null;

  return (
    <div className="grid gap-6 py-6 xl:grid-cols-[360px_1fr]">
      <aside className="no-print space-y-5 xl:sticky xl:top-16 xl:h-[calc(100vh-80px)] xl:overflow-auto xl:pe-2">
        <div>
          <label className="label mb-1 block">{t.title}</label>
          <input value={title} aria-label={t.title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-line px-3 py-2 outline-none focus:border-brand" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label><span className="label mb-1 block">{t.period}</span>
            <select value={type} onChange={(e) => { const t = e.target.value as PeriodType; setType(t); const es = selectableEnds(c.months, t, c.settings.fyStartMonth); setEnd(es[es.length - 1]?.end ?? end); }} className="w-full rounded border border-line px-2 py-2">
              <option value="month">{t.month}</option><option value="quarter">{t.quarter}</option><option value="year">{t.year}</option>
            </select></label>
          <label><span className="label mb-1 block">{t.of}</span>
            <select value={validEnd} onChange={(e) => setEnd(e.target.value)} className="w-full rounded border border-line px-2 py-2">
              {[...ends].reverse().map((e) => <option key={e.end} value={e.end}>{T.pl(e.label)}</option>)}
            </select></label>
        </div>
        <div className="flex flex-wrap gap-2">
          {!demo && <button onClick={save} disabled={!!busy} className="flex items-center gap-1.5 rounded bg-brand-d px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t.save}</button>}
          <button onClick={pdf} disabled={!!busy} className="flex items-center gap-1.5 rounded border border-brand-d px-3 py-2 text-sm font-medium text-brand-d disabled:opacity-60" data-testid="download-pdf">{busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{t.pdf}</button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded border border-line px-3 py-2 text-sm"><Printer className="h-4 w-4" />{t.print}</button>
          {!demo && !c.readOnly && (
            <ConfirmDialog testId="delete-report-dialog" title={t.delTitle} confirmLabel={t.delConfirm}
              trigger={<button className="flex items-center gap-1.5 rounded border border-line px-3 py-2 text-sm text-red hover:bg-red/5" data-testid="delete-report"><Trash2 className="h-4 w-4" />{t.del}</button>}
              onConfirm={async () => { const r = await deleteReport(c.id, report.id); if (!r.ok) return r.error; router.push(`${c.basePath}/reports`); }}>
              <p>{t.delText(title, !!token)}</p>
            </ConfirmDialog>
          )}
        </div>
        {!demo && (
          <div className="rounded-md border border-line p-3 text-sm">
            <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-1.5 font-medium"><Globe className="h-4 w-4" />{t.share}</span>
              <button onClick={() => publish(!token)} disabled={!!busy} className={cn("rounded px-2.5 py-1 text-xs font-medium", token ? "bg-band" : "bg-brand-d text-white")}>{token ? t.stop : t.publish}</button></div>
            {!token && (
              <label className="mb-2 flex items-center gap-2 text-xs text-mute">{t.linkWorks}
                <select value={expiry} onChange={(e) => setExpiry(Number(e.target.value) as 0 | 30 | 90)} className="rounded border border-line px-1 py-0.5" data-testid="link-expiry">
                  <option value={0}>{t.untilStop}</option><option value={30}>{t.d30}</option><option value={90}>{t.d90}</option>
                </select>
              </label>
            )}
            {shareUrl ? <div className="flex items-center gap-2"><input readOnly aria-label={t.share} value={shareUrl} className="min-w-0 flex-1 rounded border border-line bg-band px-2 py-1 text-xs" /><button onClick={() => navigator.clipboard.writeText(shareUrl)} aria-label={t.copy}><Copy className="h-4 w-4 text-mute" /></button></div>
              : <p className="text-xs text-mute">{t.publishHint}</p>}
            {shareUrl && <p className="mt-1.5 text-xs text-mute">{expiresAt ? t.expires(shortDate(expiresAt)) : t.worksUntil}{t.range}</p>}
            {shareUrl && frozenAt && (
              <div className="mt-2 rounded bg-band px-2 py-1.5 text-xs" data-testid="frozen-at">
                {t.frozen(shortDate(frozenAt, true))}
                {!demo && <button onClick={() => run("freeze", async () => { const r = await updatePublishedFigures(report.id); if (!r.ok) throw new Error(r.error); setFrozenAt(r.frozenAt); setMsg({ ok: true, text: t.refrozen }); })}
                  disabled={!!busy} className="ms-1 font-medium text-brand-d underline disabled:opacity-60" data-testid="refreeze">{busy === "freeze" ? t.updating : t.refreeze}</button>}
              </div>
            )}
          </div>
        )}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label">{t.sections}</span>
            {c.aiEnabled && !demo && <button onClick={() => ai()} disabled={!!busy} className="flex items-center gap-1 rounded bg-[#efe9fb] px-2.5 py-1 text-xs font-medium text-[#5b3aa8] disabled:opacity-60" data-testid="ai-all">{busy === "ai" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{t.aiAll}</button>}
          </div>
          {!c.aiEnabled && !demo && <p className="mb-2 text-xs text-mute">{t.aiOff}</p>}
          {demo && <p className="mb-2 text-xs text-mute">{t.aiDemo}</p>}
          <div className="space-y-1">
            {sections.map((s, i) => {
              const meta = REPORT_SECTIONS.find((x) => x.key === s.key)!;
              const ck = SECTION_COMMENT[s.key];
              const label = T.d.rep.secs[s.key] ?? meta.label;
              return (
                <div key={s.key} className={cn("rounded border border-line", !s.enabled && "border-dashed bg-band")}>
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-sm">
                    <button onClick={() => setSections((x) => x.map((y) => (y.key === s.key ? { ...y, enabled: !y.enabled } : y)))} aria-label={s.enabled ? t.hide(label) : t.show(label)} className="flex h-6 w-6 items-center justify-center">{s.enabled ? <Eye className="h-4 w-4 text-brand-d" /> : <EyeOff className="h-4 w-4 text-mute" />}</button>
                    <span className={cn("flex-1", !s.enabled && "text-mute")}>{label}</span>
                    {ck && <button onClick={() => setEditing(editing === ck ? null : ck)} className={cn("min-h-6 rounded px-1.5 text-xs", comments[ck] ? "bg-brand-bg text-brand-d" : "text-mute hover:bg-band")}>{comments[ck] ? t.commented : t.comment}</button>}
                    <button onClick={() => move(i, -1)} aria-label={t.up} className="flex h-6 w-6 items-center justify-center text-mute hover:text-ink"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button onClick={() => move(i, 1)} aria-label={t.down} className="flex h-6 w-6 items-center justify-center text-mute hover:text-ink"><ArrowDown className="h-3.5 w-3.5" /></button>
                  </div>
                  {ck && editing === ck && (
                    <div className="border-t border-line p-2">
                      <textarea rows={5} value={stripMemoStamp(comments[ck])} onChange={(e) => setComments((x) => ({ ...x, [ck]: e.target.value }))} placeholder={t.placeholder} className="w-full rounded border border-line px-2 py-1.5 text-[13px] outline-none focus:border-brand" />
                      <div className="mt-1.5 flex gap-2">
                        {c.aiEnabled && !demo && <button onClick={() => ai(ck)} disabled={!!busy} className="flex items-center gap-1 rounded bg-[#efe9fb] px-2 py-1 text-xs text-[#5b3aa8]">{busy === `ai:${ck}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}{t.aiOne}</button>}
                        <button onClick={() => saveComment(ck)} disabled={!!busy} className="ms-auto rounded bg-brand-d px-2.5 py-1 text-xs text-white">{demo ? t.done : t.saveComment}</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {msg && <p className={cn("rounded px-3 py-2 text-sm", msg.ok ? "bg-green-bg text-green-d" : "bg-red-bg text-red")}>{msg.text}</p>}
      </aside>
      <div tabIndex={0} className="min-w-0 overflow-x-auto bg-[#ecece8] py-6 print:bg-white print:p-0" data-testid="report-preview">
        <ReportDocument input={input} />
      </div>
    </div>
  );
}
