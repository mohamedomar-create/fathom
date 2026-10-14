"use client";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/cn";

export type Screen = "what" | "get" | "upload" | "check" | "save" | "done";
const STEPS: { k: Screen; label: string }[] = [
  { k: "what", label: "What" }, { k: "get", label: "Get file" }, { k: "upload", label: "Upload" },
  { k: "check", label: "Check" }, { k: "save", label: "Save" }, { k: "done", label: "Done" },
];

/** The steps of an upload, the current one in bold and finished ones ticked. */
export function WizardSteps({ at }: { at: Screen }) {
  const i = STEPS.findIndex((s) => s.k === at);
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[13px]" data-testid="wiz-steps" data-at={at}>
      {STEPS.map((s, k) => (
        <li key={s.k} className="flex items-center gap-1.5" data-testid={`wiz-step-${s.k}`} aria-current={k === i ? "step" : undefined}>
          <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold", k < i ? "bg-brand-d text-white" : k === i ? "bg-ink text-white" : "bg-band text-mute")}>
            {k < i ? <Check className="h-3.5 w-3.5" /> : k + 1}
          </span>
          <span className={cn(k === i ? "font-semibold" : "text-mute")}>{s.label}</span>
          {k < STEPS.length - 1 && <span className="mx-0.5 h-px w-4 bg-line sm:w-6" />}
        </li>
      ))}
    </ol>
  );
}

/** A screen's title and its one-line hint. */
export function WizardTitle({ title, hint }: { title: string; hint?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h2 className="text-2xl font-light">{title}</h2>
      {hint && <p className="mt-1 text-[15px] text-mute">{hint}</p>}
    </div>
  );
}

/** Back on the left, the main action on the right; stays in view at the bottom of the screen. */
export function WizardNav({ back, onBack, next, onNext, disabled, busy, nextTestId = "wiz-next", hint, href }: {
  back?: string; onBack?: () => void; next?: string; onNext?: () => void; disabled?: boolean; busy?: boolean; nextTestId?: string; hint?: React.ReactNode; href?: string;
}) {
  const cls = "inline-flex items-center gap-2 rounded-md bg-brand-d px-6 py-3 text-[15px] font-medium text-white shadow-sm disabled:opacity-40";
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 flex flex-wrap items-center gap-3 border-t border-line bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:px-0" data-testid="wiz-nav">
      {onBack && <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-md px-3 py-2.5 text-[15px] text-mute hover:bg-band" data-testid="wiz-back"><ArrowLeft className="h-4 w-4" />{back ?? "Back"}</button>}
      {hint && <span className="ml-auto text-[13px] text-mute">{hint}</span>}
      {next && (href
        ? <a href={href} className={cn(cls, !hint && "ml-auto")} data-testid={nextTestId}>{next}<ArrowRight className="h-4 w-4" /></a>
        : <button onClick={onNext} disabled={disabled || busy} className={cn(cls, !hint && "ml-auto")} data-testid={nextTestId}>{busy ? "Working…" : next}{!busy && <ArrowRight className="h-4 w-4" />}</button>)}
    </div>
  );
}

/** A big choice: an icon, a title and one short line. */
export function ChoiceCard({ icon, title, sub, onClick, selected, testId }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; selected?: boolean; testId?: string }) {
  return (
    <button onClick={onClick} data-testid={testId} aria-pressed={selected}
      className={cn("flex w-full items-start gap-4 rounded-xl border-2 p-5 text-left transition hover:border-brand hover:bg-brand-bg/30", selected ? "border-brand-d bg-brand-bg/40" : "border-line")}>
      <span className="text-3xl leading-none">{icon}</span>
      <span><span className="block text-lg font-medium">{title}</span><span className="text-[14px] text-mute">{sub}</span></span>
    </button>
  );
}
