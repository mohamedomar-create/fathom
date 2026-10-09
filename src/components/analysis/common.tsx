"use client";
import { cn } from "@/lib/cn";
import { money } from "@/lib/engine";
import type { Finding } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";

export function Tile({ label, value, neg, sub, children, testId }: { label: string; value: React.ReactNode; neg?: boolean; sub?: React.ReactNode; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="fade-up border-t-2 border-line pt-2.5" data-testid={testId}>
      <div className="label">{label}</div>
      <div className={cn("num mt-1 inline-block text-[26px] leading-tight sm:text-[28px]", neg && "bg-red-bg px-2 text-red")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs">{sub}</div>}
      {children}
    </div>
  );
}

export function MoneyTile({ label, value, testId }: { label: string; value: number; testId?: string }) {
  const { settings } = useCompany();
  return <Tile label={label} value={money(value, settings.currency)} neg={value < 0} testId={testId} />;
}

export function Notes({ findings, comment, title = "Analyst notes" }: { findings: Finding[]; comment?: string; title?: string }) {
  if (comment) return <div className="my-5 border-l-[3px] border-green bg-band px-4 py-3 text-[13px] whitespace-pre-line">{comment}</div>;
  if (!findings.length) return null;
  return (
    <div className="my-5 border-l-[3px] border-green bg-band px-4 py-3 text-[13px]">
      <div className="label mb-1">{title}</div>
      {findings.slice(0, 3).map((f) => (
        <div key={f.title} className="py-0.5"><b className="font-semibold">{f.title}.</b> {f.text}</div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <div className="mb-2 text-[40px] text-[#3B8FD0]">{icon ?? "ⓘ"}</div>
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="mt-1 text-mute">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function NeedsOpening() {
  return <EmptyState title="Opening balances needed" text="This view compares the balance sheet with the month before. The selected period is the first month loaded, so there is nothing to compare with yet. Choose a later month, or load one more month of history." />;
}

export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="my-2 flex flex-wrap gap-4 text-xs">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  );
}
