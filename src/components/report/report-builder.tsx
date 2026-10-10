"use client";
import { ArrowDown, ArrowUp, Copy, Download, Eye, EyeOff, Globe, Loader2, Printer, Save, Sparkles } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { selectableEnds, windowFor, type PeriodType } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { downloadReportPdf } from "@/lib/report/export";
import { COMMENTARY_SECTIONS } from "@/lib/ai/sections";
import { REPORT_SECTIONS, SECTION_COMMENT, type ReportOrg, type ReportSection } from "@/lib/report/types";
import { publishReport, saveCommentary, saveReport } from "@/app/company/[id]/reports/actions";
import { ReportDocument } from "./report-document";
import { cn } from "@/lib/cn";

export interface ReportRecord { id: string; title: string; period_type: PeriodType; period_end: string; sections: ReportSection[]; status: string; share_token: string | null; expires_at?: string | null }

export function ReportBuilder({ report, org, demo = false }: { report: ReportRecord; org: ReportOrg; demo?: boolean }) {
  const c = useCompany();
  const [title, setTitle] = useState(report.title);
  const [type, setType] = useState<PeriodType>(report.period_type);
  const [end, setEnd] = useState(report.period_end);
  const [sections, setSections] = useState<ReportSection[]>(report.sections);
  const [token, setToken] = useState<string | null>(report.share_token);
  const [expiresAt, setExpiresAt] = useState<string | null>(report.expires_at ?? null);
  const [expiry, setExpiry] = useState<0 | 30 | 90>(0);
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
  const footer = org.footer || `${c.name} (${windowFor({ type, end: validEnd }, c.settings.fyStartMonth).label}) - Prepared by ${org.name}`;

  const input = useMemo(() => ({
    title, companyName: c.name, months: c.months, accounts: c.accounts, settings: c.settings, alerts: c.alerts,
    sel: { type, end: validEnd }, sections, commentary: comments, org, notes: c.notes ?? [], accepted: c.accepted ?? [],
    preparedOn: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
  }), [title, c, type, validEnd, sections, comments, org]);

  const move = (i: number, d: -1 | 1) => setSections((s) => { const n = [...s]; const j = i + d; if (j < 0 || j >= n.length) return s; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const run = (key: string, f: () => Promise<void>) => { setBusy(key); setMsg(null); start(async () => { try { await f(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(null); } }); };

  const save = () => run("save", async () => {
    const r = await saveReport({ id: report.id, title, period_type: type, period_end: validEnd, sections });
    setMsg(r.ok ? { ok: true, text: "Report saved." } : { ok: false, text: r.error ?? "Could not save" });
  });
  const ai = (section?: string) => run(section ? `ai:${section}` : "ai", async () => {
    // One request per section keeps each call well inside the server function time limit.
    const results = await Promise.allSettled((section ? [section] : [...COMMENTARY_SECTIONS]).map(async (s) => {
      const res = await fetch(`/api/companies/${c.id}/commentary`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, end: validEnd, sections: [s] }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "AI commentary failed");
      return j.commentary as Record<string, string>;
    }));
    const written = Object.assign({}, ...results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : [])));
    setComments((x) => ({ ...x, ...written }));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed && !Object.keys(written).length) throw failed.reason;
    setMsg({ ok: !failed, text: `AI commentary written for ${Object.keys(written).length} section(s).${failed ? ` Some sections failed: ${(failed.reason as Error).message}` : ""} Review and edit before sending.` });
  });
  const saveComment = (section: string) => run(`c:${section}`, async () => {
    if (demo) { setEditing(null); return; }
    const r = await saveCommentary(c.id, periodKey, section, comments[section] ?? "");
    if (!r.ok) throw new Error(r.error);
    setEditing(null);
  });
  const publish = (on: boolean) => run("pub", async () => {
    await saveReport({ id: report.id, title, period_type: type, period_end: validEnd, sections });
    const r = await publishReport(report.id, on, expiry);
    if (!r.ok) throw new Error(r.error);
    setToken(r.token ?? null);
    setExpiresAt(r.expiresAt ?? null);
    setMsg({ ok: true, text: on ? `Published. Anyone with the link can view this report${expiry ? ` for ${expiry} days` : ""}.` : "Sharing stopped. The link no longer works." });
  });
  const pdf = () => run("pdf", async () => { await downloadReportPdf({ title: `${c.name} - ${title}`, footer, demo }); });
  const shareUrl = token && typeof window !== "undefined" ? `${window.location.origin}/r/${token}` : null;

  return (
    <div className="grid gap-6 py-6 xl:grid-cols-[360px_1fr]">
      <aside className="no-print space-y-5 xl:sticky xl:top-16 xl:h-[calc(100vh-80px)] xl:overflow-auto xl:pr-2">
        <div>
          <label className="label mb-1 block">Report title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-line px-3 py-2 outline-none focus:border-green" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label><span className="label mb-1 block">Period</span>
            <select value={type} onChange={(e) => { const t = e.target.value as PeriodType; setType(t); const es = selectableEnds(c.months, t, c.settings.fyStartMonth); setEnd(es[es.length - 1]?.end ?? end); }} className="w-full rounded border border-line px-2 py-2">
              <option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option>
            </select></label>
          <label><span className="label mb-1 block">Of</span>
            <select value={validEnd} onChange={(e) => setEnd(e.target.value)} className="w-full rounded border border-line px-2 py-2">
              {[...ends].reverse().map((e) => <option key={e.end} value={e.end}>{e.label}</option>)}
            </select></label>
        </div>
        <div className="flex flex-wrap gap-2">
          {!demo && <button onClick={save} disabled={!!busy} className="flex items-center gap-1.5 rounded bg-green-d px-3 py-2 text-sm font-medium text-white disabled:opacity-60">{busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</button>}
          <button onClick={pdf} disabled={!!busy} className="flex items-center gap-1.5 rounded border border-green-d px-3 py-2 text-sm font-medium text-green-d disabled:opacity-60" data-testid="download-pdf">{busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download PDF</button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded border border-line px-3 py-2 text-sm"><Printer className="h-4 w-4" />Print</button>
        </div>
        {!demo && (
          <div className="rounded-md border border-line p-3 text-sm">
            <div className="mb-2 flex items-center justify-between"><span className="flex items-center gap-1.5 font-medium"><Globe className="h-4 w-4" />Share link</span>
              <button onClick={() => publish(!token)} disabled={!!busy} className={cn("rounded px-2.5 py-1 text-xs font-medium", token ? "bg-band" : "bg-green-d text-white")}>{token ? "Stop sharing" : "Publish report"}</button></div>
            {!token && (
              <label className="mb-2 flex items-center gap-2 text-xs text-mute">Link works
                <select value={expiry} onChange={(e) => setExpiry(Number(e.target.value) as 0 | 30 | 90)} className="rounded border border-line px-1 py-0.5" data-testid="link-expiry">
                  <option value={0}>until you stop sharing</option><option value={30}>for 30 days</option><option value={90}>for 90 days</option>
                </select>
              </label>
            )}
            {shareUrl ? <div className="flex items-center gap-2"><input readOnly value={shareUrl} className="min-w-0 flex-1 rounded border border-line bg-band px-2 py-1 text-xs" /><button onClick={() => navigator.clipboard.writeText(shareUrl)} aria-label="Copy link"><Copy className="h-4 w-4 text-mute" /></button></div>
              : <p className="text-xs text-mute">Publish to get a read-only link you can send to the client or board.</p>}
            {shareUrl && <p className="mt-1.5 text-xs text-mute">{expiresAt ? `Expires on ${new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}.` : "Works until you stop sharing."} Shows the report&apos;s period and up to three years before it, nothing older.</p>}
          </div>
        )}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Sections &amp; commentary</span>
            {c.aiEnabled && !demo && <button onClick={() => ai()} disabled={!!busy} className="flex items-center gap-1 rounded bg-[#efe9fb] px-2.5 py-1 text-xs font-medium text-[#5b3aa8] disabled:opacity-60" data-testid="ai-all">{busy === "ai" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}Write all with AI</button>}
          </div>
          {!c.aiEnabled && !demo && <p className="mb-2 text-xs text-mute">AI commentary is off: add ANTHROPIC_API_KEY on the server to enable it. Rule-based analyst notes are used meanwhile.</p>}
          {demo && <p className="mb-2 text-xs text-mute">In your own account, “Write with AI” drafts the commentary from these numbers.</p>}
          <div className="space-y-1">
            {sections.map((s, i) => {
              const meta = REPORT_SECTIONS.find((x) => x.key === s.key)!;
              const ck = SECTION_COMMENT[s.key];
              return (
                <div key={s.key} className={cn("rounded border border-line", !s.enabled && "opacity-55")}>
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-sm">
                    <button onClick={() => setSections((x) => x.map((y) => (y.key === s.key ? { ...y, enabled: !y.enabled } : y)))} aria-label={s.enabled ? `Hide ${meta.label}` : `Show ${meta.label}`}>{s.enabled ? <Eye className="h-4 w-4 text-green-d" /> : <EyeOff className="h-4 w-4 text-mute" />}</button>
                    <span className="flex-1">{meta.label}</span>
                    {ck && <button onClick={() => setEditing(editing === ck ? null : ck)} className={cn("rounded px-1.5 text-xs", comments[ck] ? "bg-green-bg text-green-d" : "text-mute hover:bg-band")}>{comments[ck] ? "Comment ✓" : "Comment"}</button>}
                    <button onClick={() => move(i, -1)} aria-label="Move up" className="text-mute hover:text-ink"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button onClick={() => move(i, 1)} aria-label="Move down" className="text-mute hover:text-ink"><ArrowDown className="h-3.5 w-3.5" /></button>
                  </div>
                  {ck && editing === ck && (
                    <div className="border-t border-line p-2">
                      <textarea rows={5} value={comments[ck] ?? ""} onChange={(e) => setComments((x) => ({ ...x, [ck]: e.target.value }))} placeholder="Leave empty to use the automatic analyst notes" className="w-full rounded border border-line px-2 py-1.5 text-[13px] outline-none focus:border-green" />
                      <div className="mt-1.5 flex gap-2">
                        {c.aiEnabled && !demo && <button onClick={() => ai(ck)} disabled={!!busy} className="flex items-center gap-1 rounded bg-[#efe9fb] px-2 py-1 text-xs text-[#5b3aa8]">{busy === `ai:${ck}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}Write with AI</button>}
                        <button onClick={() => saveComment(ck)} disabled={!!busy} className="ml-auto rounded bg-green-d px-2.5 py-1 text-xs text-white">{demo ? "Done" : "Save comment"}</button>
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
      <div className="min-w-0 overflow-x-auto bg-[#ecece8] py-6 print:bg-white print:p-0" data-testid="report-preview">
        <ReportDocument input={input} />
      </div>
    </div>
  );
}
