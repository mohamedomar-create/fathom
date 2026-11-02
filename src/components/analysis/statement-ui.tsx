"use client";
import { useState, useTransition } from "react";
import * as Pop from "@radix-ui/react-popover";
import { money, pct } from "@/lib/engine/format";
import { flagChange, lineTone, MARK_COLORS, rowKind, wrongSide, type Highlights, type Mark, type MarkColor, type Tone } from "@/lib/engine/statement-rows";
import { useT } from "@/lib/i18n/use-t";
import { cn } from "@/lib/cn";

/** The row's classes: shading for totals, the editor's colour mark, and the flag edge. */
export function rowCls(key: string, opts: { mark?: Mark | null; flagged?: boolean; base?: string } = {}) {
  const k = rowKind(key);
  return cn(opts.base ?? "row", k !== "line" && "tot", k === "total" && "sub", k === "grand" && "grand", opts.mark && `mk-${opts.mark.color}`, opts.flagged && "flagged");
}

/** Why a line needs a look, or null: a move over both thresholds, or a balance on the wrong side. */
export function flagReason(statement: "PL" | "BS" | "CF", key: string, cur: number, cmp: number | null | undefined, h: Highlights | undefined, fmt: (v: number) => string, T: ReturnType<typeof useT>) {
  if (statement === "BS" && wrongSide(key, cur)) return T.d.hl.flagWrongSide;
  if (h && flagChange(cur, cmp, h)) {
    const d = cur - (cmp ?? 0);
    return cmp ? T.d.hl.flagMove(pct((d / Math.abs(cmp)) * 100, 0), (d >= 0 ? "+" : "") + fmt(d)) : T.d.hl.flagNew(fmt(d));
  }
  return null;
}

/** A change cell: the figure with ▲/▼ and its sign, shaded green when better and red when worse (never colour alone). */
export function ChangeCell({ statement, k, cur, cmp, kind, fmt }: { statement: "PL" | "BS" | "CF"; k: string; cur: number; cmp: number | null | undefined; kind: "pct" | "money"; fmt: (v: number) => string }) {
  const T = useT();
  if (cmp === null || cmp === undefined || (kind === "pct" && !cmp)) return <td className="text-mute">–</td>;
  const d = cur - cmp;
  const tone: Tone = lineTone(statement, k, cur, cmp);
  const text = kind === "pct" ? pct((d / Math.abs(cmp)) * 100) : fmt(d);
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "";
  return (
    <td className={cn("relative", tone !== "neutral" && `tone-${tone}`)} data-tone={tone}>
      {arrow && <span aria-hidden className="me-1 text-[10px]">{arrow}</span>}{text}
      {tone !== "neutral" && <span className="sr-only"> ({tone === "better" ? T.d.hl.better : T.d.hl.worse})</span>}
    </td>
  );
}

/** The ⚠ beside a line's name, with the reason in a tooltip and for screen readers. */
export function Flag({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return <span tabIndex={0} className="flag-ic relative ms-1 cursor-help" title={reason} data-testid="line-flag"><span aria-hidden>⚠</span><span className="sr-only">{reason}</span></span>;
}

/**
 * The editor's colour mark for one line: a small swatch that opens five colours and a short note. Viewers see the
 * mark's colour and note but get no button.
 */
export function MarkButton({ markKey, mark, canEdit, onSave, label }: { markKey: string; mark: Mark | null; canEdit: boolean; onSave: (key: string, m: Mark | null) => Promise<{ ok: boolean; error?: string }>; label: string }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState<MarkColor | null>(mark?.color ?? null);
  const [note, setNote] = useState(mark?.note ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dot = <span aria-hidden className={cn("inline-block h-3 w-3 rounded-full border border-line", mark ? `mk-dot-${mark.color}` : "bg-white")} />;
  if (!canEdit) return mark ? <span tabIndex={0} className="relative ms-1 inline-flex align-middle" title={mark.note || T.d.hl.marked(T.d.hl.colors[mark.color])} data-testid="mark-dot">{dot}<span className="sr-only">{T.d.hl.marked(T.d.hl.colors[mark.color])}{mark.note ? `: ${mark.note}` : ""}</span></span> : null;
  const save = (m: Mark | null) => start(async () => {
    setErr(null);
    const r = await onSave(markKey, m);
    if (!r.ok) return setErr(r.error ?? "");
    setOpen(false);
  });
  return (
    <Pop.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) { setColor(mark?.color ?? null); setNote(mark?.note ?? ""); setErr(null); } }}>
      <Pop.Trigger className="ms-1 inline-flex h-6 w-6 items-center justify-center rounded align-middle opacity-70 hover:bg-band hover:opacity-100 print:hidden" aria-label={`${T.d.hl.mark}: ${label}`} title={mark?.note || T.d.hl.mark} data-testid="mark-btn">{dot}</Pop.Trigger>
      <Pop.Portal>
        <Pop.Content sideOffset={4} className="z-50 w-64 rounded-md border border-line bg-white p-3 text-sm shadow-lg" data-testid="mark-pop">
          <div className="label mb-2">{T.d.hl.mark}</div>
          <div className="mb-2 flex gap-2" role="radiogroup" aria-label={T.d.hl.mark}>
            {MARK_COLORS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={T.d.hl.colors[c]} onClick={() => setColor(c)}
                className={cn("h-7 w-7 rounded-full border-2", `mk-dot-${c}`, color === c ? "border-ink" : "border-transparent")} data-testid={`mark-${c}`} />
            ))}
          </div>
          <label className="block"><span className="label mb-1 block">{T.d.hl.markNote}</span>
            <input value={note} maxLength={120} onChange={(e) => setNote(e.target.value)} className="w-full rounded border border-line px-2 py-1" data-testid="mark-note" /></label>
          {err && <p role="alert" className="mt-2 text-red">{err}</p>}
          <div className="mt-3 flex justify-between">
            <button type="button" disabled={pending || !mark} onClick={() => save(null)} className="text-mute hover:underline disabled:opacity-40" data-testid="mark-clear">{T.d.hl.clearMark}</button>
            <button type="button" disabled={pending || !color} onClick={() => color && save(note.trim() ? { color, note: note.trim() } : { color })} className="rounded bg-brand-d px-3 py-1 text-white disabled:opacity-50" data-testid="mark-save">{T.d.hl.saveMark}</button>
          </div>
        </Pop.Content>
      </Pop.Portal>
    </Pop.Root>
  );
}

/** Money formatter bound to a currency, for flag reasons. */
export const fmtIn = (cur: string) => (v: number) => money(v, cur);

/** Cash-flow totals: the change in cash and the closing balance are what readers look for first. */
export const cfRowCls = (label: string, total?: boolean) => cn("row", total && "tot", total && (/^(Change in Cash|Closing Balance)/.test(label) ? "grand" : "sub"));

/** Under a statement: why each ⚠ line needs a look and each editor's note, numbered, so a printed page explains itself. */
export function StatementNotes({ notes }: { notes: { label: string; text: string }[] }) {
  if (!notes.length) return null;
  return (
    <ol className="mt-2 list-decimal space-y-0.5 ps-5 text-[11px] text-mute" data-testid="statement-notes">
      {notes.map((n, i) => <li key={i}><span className="font-semibold text-ink">{n.label}</span>: {n.text}</li>)}
    </ol>
  );
}
