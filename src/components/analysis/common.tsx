"use client";
import { cn } from "@/lib/cn";
import { money, type PeriodView } from "@/lib/engine";
import type { Finding } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { useT } from "@/lib/i18n/use-t";

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

export function MoneyTile({ label, value, testId, sub }: { label: string; value: number; testId?: string; sub?: string }) {
  const { settings } = useCompany();
  return <Tile label={label} value={money(value, settings.currency)} neg={value < 0} testId={testId} sub={sub ? <span className="text-mute">{sub}</span> : undefined} />;
}

export function Notes({ findings, comment, title }: { findings: Finding[]; comment?: string; title?: string }) {
  const t = useT().d.ana;
  if (comment) return <div className="my-5 border-s-[3px] border-brand bg-band px-4 py-3 text-[13px] whitespace-pre-line">{comment}</div>;
  if (!findings.length) return null;
  return (
    <div className="my-5 border-s-[3px] border-brand bg-band px-4 py-3 text-[13px]">
      <div className="label mb-1">{title ?? t.analystNotes}</div>
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
  const t = useT().d.ana;
  return <EmptyState title={t.openingNeeded} text={t.openingNeededText} />;
}

/**
 * Says exactly which statements the selected period lacks and what to upload. `need` picks the view's requirements:
 * "cash" needs both balance sheets (the period's end and the month before it), "pl" needs every month's P&L.
 */
export function MissingData({ view, basePath, need }: { view: PeriodView; basePath: string; need: "cash" | "pl" }) {
  const T = useT();
  const t = T.d.ana;
  const m = view.missing;
  const items: string[] = [];
  const list = (ps: string[]) => (ps.length <= 3 ? ps.map(T.ml).join(", ") : t.nMonths(ps.length, T.ml(ps[0]), T.ml(ps[ps.length - 1])));
  if (m.pl.length) items.push(t.missingPL(list(m.pl)));
  if (need === "cash" && m.endBS) items.push(t.missingBS(T.ml(view.window.end), view.bsAt ? T.ml(view.bsAt) : null));
  if (need === "cash" && m.openingBS) items.push(t.missingOpening(T.ml(m.opening)));
  if (!items.length) return null;
  const blocking = need === "cash" ? m.endBS || m.openingBS : false;
  return (
    <div className={`mb-5 rounded-md border px-4 py-3 text-sm ${blocking ? "border-amber/60 bg-amber/10" : "border-line bg-band"}`} data-testid="missing-data" role="status">
      <div className="mb-1 font-medium">{blocking ? t.dataNeeded : t.partLoaded}</div>
      <ul className="list-disc space-y-0.5 ps-5">{items.map((t) => <li key={t}>{t}</li>)}</ul>
      <p className="mt-2 text-mute">{t.bestFix}</p>
      <a href={`${basePath}/data`} className="mt-2 inline-block rounded bg-brand-d px-3 py-1.5 text-white" data-testid="missing-upload">{t.uploadData}</a>
    </div>
  );
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
