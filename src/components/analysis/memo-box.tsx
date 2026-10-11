"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { useComments, usePeriod } from "@/lib/company/use-period";
import { cn } from "@/lib/cn";

const HEADINGS = /^(lead with|risks and how to answer them|what to ask for|questions to expect)\s*:?$/i;

/** Memo text as written by the AI or the automatic memo: a headline, then headed groups of "• " bullets. */
export function MemoText({ text, className }: { text: string; className?: string }) {
  const blocks: { heading?: string; lines: string[] }[] = [{ lines: [] }];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (HEADINGS.test(line) || (/^#+\s/.test(line))) { blocks.push({ heading: line.replace(/^#+\s*/, "").replace(/:$/, ""), lines: [] }); continue; }
    blocks[blocks.length - 1].lines.push(line);
  }
  return (
    <div className={cn("space-y-3 text-[13px]", className)}>
      {blocks.filter((b) => b.heading || b.lines.length).map((b, i) => (
        <div key={i}>
          {b.heading && <div className="label mb-1">{b.heading}</div>}
          {b.lines.some((l) => /^[•\-*]\s/.test(l)) ? (
            <ul className="space-y-1">{b.lines.map((l, j) => <li key={j} className={/^[•\-*]\s/.test(l) ? "pl-3 -indent-3" : ""}>{l.replace(/^[-*]\s/, "• ")}</li>)}</ul>
          ) : b.lines.map((l, j) => <p key={j} className={i === 0 && j === 0 ? "text-[14px] font-medium" : ""}>{l}</p>)}
        </div>
      ))}
    </div>
  );
}

/** Saved commentary for a section (AI or typed), else the automatic text, with a "Draft with AI" button for editors. */
export function MemoBox({ section, title, fallback, testId }: { section: "bank" | "realprofit"; title: string; fallback: string | null; testId?: string }) {
  const c = useCompany();
  const { sel } = usePeriod();
  const comments = useComments();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const saved = comments(section);
  const canAi = Boolean(c.aiEnabled) && !c.readOnly && c.source !== "demo";
  const draft = () => start(async () => {
    setErr(null);
    const res = await fetch(`/api/companies/${c.id}/commentary`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: sel.type, end: sel.end, sections: [section] }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error ?? "The AI could not write this."); return; }
    router.refresh();
  });
  const text = saved ?? fallback;
  return (
    <section className="rounded-lg border-l-[3px] border-brand bg-band px-4 py-4" data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-normal">{title}</h2>
        <span className="rounded bg-white px-1.5 py-0.5 text-[11px] text-mute">{saved ? "Saved for this period" : "Automatic, from the figures"}</span>
        {canAi && <button onClick={draft} disabled={pending} className="ml-auto inline-flex items-center gap-1.5 rounded border border-brand-d px-3 py-1.5 text-xs font-medium text-brand-d disabled:opacity-60" data-testid={`ai-${section}`}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}{saved ? "Redraft with AI" : "Draft with AI"}</button>}
      </div>
      {text ? <MemoText text={text} /> : <p className="text-sm text-mute">Nothing to say yet for this period.</p>}
      {err && <p className="mt-2 text-sm text-red" role="alert">{err}</p>}
      {!canAi && c.source !== "demo" && !c.aiEnabled && <p className="mt-3 text-xs text-mute">AI drafting is not switched on for this workspace; the automatic memo is built from the figures alone.</p>}
    </section>
  );
}
