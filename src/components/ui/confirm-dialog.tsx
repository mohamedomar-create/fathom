"use client";
import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogTrigger } from "./dialog";
import { cn } from "@/lib/cn";

/**
 * Confirmation for an action that cannot be undone. With `typeToConfirm`, the button stays disabled until that text is typed
 * (case does not matter). `onConfirm` gets the typed text and returns an error message to show, or nothing on success (it may navigate away).
 */
export function ConfirmDialog({ trigger, title, children, typeToConfirm, typeLabel, confirmLabel, onConfirm, testId }: {
  trigger: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  typeToConfirm?: string;
  typeLabel?: string;
  confirmLabel: string;
  onConfirm: (typed: string) => Promise<string | void | undefined>;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.trim().toLowerCase();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setTyped(""); setError(null); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} className="w-[min(520px,calc(100vw-24px))] p-6" data-testid={testId}>
        <h2 className="mb-3 pr-8 text-xl font-light">{title}</h2>
        <div className="space-y-2 text-sm text-ink">{children}</div>
        <form className="mt-5" onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          start(async () => { const r = await onConfirm(typed.trim()); if (r) setError(r); else setOpen(false); });
        }}>
          {typeToConfirm && (
            <label className="mb-4 block"><span className="mb-1 block text-sm">{typeLabel ?? "Type"} <strong className="break-all">{typeToConfirm}</strong> to confirm</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} data-testid="confirm-input"
                className="w-full rounded border border-line px-3 py-2 outline-none focus:border-red" /></label>
          )}
          {error && <p className="mb-3 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded border border-line px-4 py-2 text-sm hover:bg-band">Cancel</button>
            <button disabled={!ready || pending} data-testid="confirm-button"
              className={cn("rounded bg-red px-4 py-2 text-sm font-medium text-white", (!ready || pending) && "opacity-50")}>{pending ? "Working…" : confirmLabel}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
