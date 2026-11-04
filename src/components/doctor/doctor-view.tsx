"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldCheck, Sparkles, Stethoscope } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Cockpit, HeroKpi, KpiTile } from "@/components/viz/kpi";
import { Amt } from "@/components/analysis/budget-visuals";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { useCompany } from "@/lib/company/context";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";
import type { Area, Finding } from "@/lib/doctor/findings";
import type { DoctorData } from "@/lib/doctor/load";
import { acceptFinding, undoFinding } from "@/app/company/[id]/doctor/actions";

const AREAS: ("all" | Area)[] = ["all", "books", "sales", "expenses", "stock", "payments", "setup"];
const SEV_TONE = { high: "bg-red/10 text-red", medium: "bg-amber/15 text-ink", low: "bg-band text-ink-2" } as const;

async function askServer(companyId: string, body: Record<string, unknown>): Promise<{ answer?: string; error?: string }> {
  try {
    const r = await fetch(`/api/companies/${companyId}/doctor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { answer?: string; error?: string };
    return r.ok ? { answer: j.answer } : { error: j.error ?? `Error ${r.status}` };
  } catch { return { error: "Could not reach the server. Try again." }; }
}

/** An AI answer, shown only after its figures were checked; or the reason it can't be shown. */
function Answer({ text, error, testId }: { text?: string; error?: string; testId: string }) {
  const t = useT().d.doc;
  // The live region stays mounted, so a screen reader announces the answer when it arrives.
  return (
    <div aria-live="polite">
      {error && <p role="alert" className="mt-3 rounded-md bg-red/5 p-3 text-sm text-red" data-testid={`${testId}-error`}>{error}</p>}
      {!error && text && (
        <div className="mt-3 rounded-md border border-brand/30 bg-brand-bg/40 p-3 text-sm leading-relaxed" data-testid={testId}>
          <p className="whitespace-pre-line" dir="auto">{text}</p>
          <p className="mt-2 flex items-center gap-1 text-xs text-green-d"><ShieldCheck className="h-3.5 w-3.5" aria-hidden />{t.verified}</p>
        </div>
      )}
    </div>
  );
}

function AcceptButton({ f, companyId }: { f: Finding; companyId: string }) {
  const t = useT().d.doc;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); setErr(null); }}>
      <DialogTrigger className="inline-flex items-center rounded border border-line bg-white px-3 py-1.5 text-xs hover:bg-band disabled:opacity-50" data-testid="doctor-accept">{t.accept}</DialogTrigger>
      <DialogContent title={t.acceptTitle} className="w-[min(520px,calc(100vw-24px))] p-6">
        <h2 className="t-card pe-8">{t.acceptTitle}</h2>
        <p className="mt-1 text-sm font-medium">{f.flag ? t.flagTitle[f.flag.k](f.flag.supplier) : f.title}</p>
        <p className="mt-2 text-sm text-ink-2">{t.acceptText}</p>
        <label className="mt-4 block text-sm font-medium" htmlFor="doctor-reason">{t.reason}</label>
        <textarea id="doctor-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} placeholder={t.reasonPh}
          className="mt-1 w-full rounded-md border border-line p-2 text-sm" data-testid="doctor-reason" />
        {err && <p role="alert" className="mt-2 text-sm text-red">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose className="rounded border border-line px-4 py-2 text-sm">{t.cancel}</DialogClose>
          <button type="button" className="rounded bg-brand-d px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={pending || reason.trim().length < 3} data-testid="doctor-accept-save"
            onClick={() => start(async () => {
              const r = await acceptFinding(companyId, f.key, f.title, reason, f.impact);
              if (!r.ok) { setErr(r.error); return; }
              setOpen(false); setReason(""); router.refresh();
            })}>{t.save}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FindingCard({ f, companyId, canEdit, aiOn, lang }: { f: Finding; companyId: string | null; canEdit: boolean; aiOn: boolean; lang: "en" | "ar" }) {
  const { d, ml } = useT();
  const t = d.doc;
  const router = useRouter();
  const [ans, setAns] = useState<{ text?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const [undoing, startUndo] = useTransition();
  const at = f.accepted?.at ? new Date(f.accepted.at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB") : "";
  return (
    <li className={cn("rounded-xl border border-line bg-white p-4", f.accepted && "opacity-80")} data-testid="doctor-finding" data-key={f.key}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={cn("rounded px-1.5 py-0.5 font-medium", SEV_TONE[f.severity])}>{t.severity[f.severity]}</span>
            <span className="text-mute">{t.areas[f.area]}</span>
            {f.period && <span className="text-mute">· {ml(f.period)}</span>}
          </div>
          <h3 className="t-card mt-1">{f.flag ? t.flagTitle[f.flag.k](f.flag.supplier) : f.title}</h3>
          <p className="mt-1 text-sm text-ink-2">{!f.flag ? f.detail : f.flag.k === "double" ? t.flagDetail.double(f.flag.doc, f.flag.doc2 ?? t.anotherBill, f.flag.type) : t.flagDetail.large(f.flag.doc, f.flag.type)}</p>
        </div>
        <div className="text-end">
          {f.impact !== null ? <div className="t-kpi"><Amt v={f.impact} /></div> : <div className="text-sm text-mute">{t.noAmount}</div>}
          {f.basis && <div className="text-xs text-mute">{t.basis[f.basis]}</div>}
        </div>
      </div>
      {f.reopened && (
        <p className="mt-2 rounded-md bg-amber/10 p-2 text-xs" data-testid="doctor-reopened">
          {t.reopened(f.reopened.amount ?? 0)}: {f.reopened.reason}
        </p>
      )}
      {f.accepted && (
        <p className="mt-2 rounded-md bg-band p-2 text-xs text-ink-2" data-testid="doctor-accepted-reason">
          {f.accepted.by === "upload" ? t.acceptedAtUpload : t.acceptedOn(at)}: {f.accepted.reason}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link prefetch={false} href={f.href} className="inline-flex items-center rounded border border-line bg-white px-3 py-1.5 text-xs hover:bg-band disabled:opacity-50">{t.lookInto}</Link>
        {aiOn && companyId && !f.accepted && (
          <button type="button" className="inline-flex items-center rounded border border-line bg-white px-3 py-1.5 text-xs hover:bg-band disabled:opacity-50" disabled={pending} data-testid="doctor-explain"
            onClick={() => start(async () => { const r = await askServer(companyId, { mode: "explain", key: f.key, lang }); setAns({ text: r.answer, error: r.error }); })}>
            <Sparkles className="me-1 inline h-3.5 w-3.5" aria-hidden />{pending ? t.explaining : t.explain}
          </button>
        )}
        {canEdit && companyId && !f.accepted && <AcceptButton f={f} companyId={companyId} />}
        {canEdit && companyId && f.accepted?.id && f.accepted.undoable && (
          <button type="button" className="inline-flex items-center rounded border border-line bg-white px-3 py-1.5 text-xs hover:bg-band disabled:opacity-50" disabled={undoing} data-testid="doctor-undo"
            onClick={() => startUndo(async () => { const r = await undoFinding(companyId, f.accepted!.id!); if (!r.ok) setAns({ error: r.error }); else router.refresh(); })}>{t.undo}</button>
        )}
      </div>
      <Answer text={ans.text} error={ans.error} testId="doctor-explanation" />
    </li>
  );
}

function AskBox({ companyId, lang }: { companyId: string; lang: "en" | "ar" }) {
  const t = useT().d.doc;
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<{ text?: string; error?: string }>({});
  const [pending, start] = useTransition();
  return (
    <section className="mb-8 rounded-xl border border-line bg-white p-4" data-testid="doctor-ask">
      <h2 className="t-card flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-d" aria-hidden />{t.ask}</h2>
      <p className="mt-1 text-sm text-ink-2">{t.askHint}</p>
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (q.trim().length < 3) return; start(async () => { setAns({}); const r = await askServer(companyId, { mode: "ask", question: q, lang }); setAns({ text: r.answer, error: r.error }); }); }}>
        <label className="sr-only" htmlFor="doctor-question">{t.ask}</label>
        <input id="doctor-question" value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder={t.askPh} className="min-w-0 flex-1 rounded-md border border-line px-3 py-2 text-sm" data-testid="doctor-question" />
        <button type="submit" className="rounded bg-brand-d px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={pending || q.trim().length < 3} data-testid="doctor-ask-go">{pending ? t.asking : t.askGo}</button>
      </form>
      <Answer text={ans.text} error={ans.error} testId="doctor-answer" />
    </section>
  );
}

/** The AI system doctor's page: the score, every finding ranked by money at stake, Explain, Accept/Undo and Ask. */
export function DoctorView({ data }: { data: DoctorData }) {
  const c = useCompany();
  const { d, lang } = useT();
  const t = d.doc;
  const [area, setArea] = useState<"all" | Area>("all");
  const demo = c.id === "demo";
  const companyId = demo ? null : c.id;
  const canEdit = !demo && !c.readOnly && !data.decisionsUnavailable;
  const aiOn = !demo && !c.readOnly && Boolean(c.aiEnabled);
  const open = data.findings.filter((f) => !f.accepted && (area === "all" || f.area === area));
  const accepted = data.findings.filter((f) => f.accepted && (area === "all" || f.area === area));
  const present = new Set(data.findings.map((f) => f.area));
  return (
    <div data-testid="doctor-page">
      <PageHeader title={t.title}><p className="max-w-prose text-sm text-ink-2">{t.intro}</p></PageHeader>
      <Cockpit testId="doctor-cockpit" hero={
        <HeroKpi label={t.score} value={<span data-testid="doctor-score">{data.score.score}</span>} deltaLabel={t.outOf} neg={data.score.score < 60}
          story={<span className="flex gap-2"><Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-brand-d" aria-hidden />{t.scoreHow}</span>} />
      }>
        <KpiTile label={t.open} value={data.score.open} accent={data.score.open ? "bad" : "good"} testId="doctor-open" />
        <KpiTile label={t.atStake} value={<Amt v={data.score.atStake} />} testId="doctor-at-stake" />
        <KpiTile label={t.accepted} value={data.findings.length - data.score.open} />
      </Cockpit>
      {data.expensesUnread && <p className="mb-4 rounded-md bg-amber/10 p-3 text-sm" role="status">{t.expensesUnread}</p>}
      {data.decisionsUnavailable && !demo && <p className="mb-4 rounded-md bg-amber/10 p-3 text-sm" role="status">{t.decisionsUnavailable}</p>}
      {!demo && c.readOnly && <p className="mb-4 text-sm text-mute">{t.viewer}</p>}
      {demo && <p className="mb-4 rounded-md bg-band p-3 text-sm" data-testid="doctor-demo-note">{t.demoAi}</p>}
      {aiOn && companyId && <AskBox companyId={companyId} lang={lang} />}
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t.filterAreas}>
        {AREAS.filter((a) => a === "all" || present.has(a)).map((a) => (
          <button key={a} type="button" aria-pressed={area === a} onClick={() => setArea(a)}
            className={cn("rounded-full border px-3 py-1 text-sm", area === a ? "border-brand-d bg-brand-bg font-medium" : "border-line bg-white")}>{t.areas[a]}</button>
        ))}
      </div>
      {data.findings.length === 0 && <p className="rounded-xl border border-line bg-white p-6 text-sm" data-testid="doctor-none">{t.none}</p>}
      <ol className="flex flex-col gap-3" data-testid="doctor-findings">
        {open.map((f) => <FindingCard key={f.key} f={f} companyId={companyId} canEdit={canEdit} aiOn={aiOn} lang={lang} />)}
      </ol>
      {accepted.length > 0 && (
        <section className="mt-8" data-testid="doctor-accepted">
          <h2 className="t-card mb-3">{t.acceptedList(accepted.length)}</h2>
          <ol className="flex flex-col gap-3">{accepted.map((f) => <FindingCard key={f.key} f={f} companyId={companyId} canEdit={canEdit} aiOn={false} lang={lang} />)}</ol>
        </section>
      )}
    </div>
  );
}
