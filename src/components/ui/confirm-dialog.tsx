"use client";
import { useState, useTransition } from "react";
import { Dialog, DialogContent, DialogTrigger } from "./dialog";
import { cn } from "@/lib/cn";
import { useDict } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { totpFactor, verifyCode } from "@/lib/auth/mfa";

/**
 * Confirmation for an action that cannot be undone. With `typeToConfirm`, the button stays disabled until that text is typed
 * (case does not matter). `onConfirm` gets the typed text and returns an error message to show, or nothing on success (it may navigate away).
 * With `reauth`, the person types their password (and their code, with two-step sign-in) first; the server checks the
 * sign-in is fresh before it deletes anything.
 */
export function ConfirmDialog({ trigger, title, children, typeToConfirm, typeLabel, confirmLabel, onConfirm, testId, reauth }: {
  trigger: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  typeToConfirm?: string;
  typeLabel?: string;
  confirmLabel: string;
  onConfirm: (typed: string) => Promise<string | void | undefined>;
  testId?: string;
  reauth?: boolean;
}) {
  const d = useDict().account;
  const a = useDict().access;
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [hasCode, setHasCode] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = (!typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.trim().toLowerCase()) && (!reauth || (!!password && (!hasCode || code.trim().length >= 6)));
  // Proves who it is: signs in again with the password (and the code), so the session is fresh for the server's check.
  const confirmIdentity = async (): Promise<string | null> => {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user?.email) return a.reauthWrong;
    const { error: e } = await supabase.auth.signInWithPassword({ email: data.user.email, password });
    if (e) return a.reauthWrong;
    if (hasCode && (await verifyCode(supabase, code))) return a.codeWrong;
    return null;
  };
  return (
    <Dialog open={open} onOpenChange={(o) => {
      setOpen(o);
      if (!o) { setTyped(""); setError(null); setPassword(""); setCode(""); }
      else if (reauth) void totpFactor(createClient()).then((f) => setHasCode(!!f));
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} className="w-[min(520px,calc(100vw-24px))] p-6" data-testid={testId}>
        <h2 className="mb-3 pe-8 text-xl font-light">{title}</h2>
        <div className="space-y-2 text-sm text-ink">{children}</div>
        <form className="mt-5" onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          start(async () => {
            if (reauth) { const bad = await confirmIdentity(); if (bad) { setError(bad); return; } }
            const r = await onConfirm(typed.trim()); if (r) setError(r); else setOpen(false);
          });
        }}>
          {typeToConfirm && (
            <label className="mb-4 block"><span className="mb-1 block text-sm">{typeLabel ?? d.type} <strong className="break-all">{typeToConfirm}</strong> {d.toConfirm}</span>
              <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} data-testid="confirm-input"
                className="w-full rounded border border-line px-3 py-2 outline-none focus:border-red" /></label>
          )}
          {reauth && (
            <div className="mb-4 rounded border border-line bg-band/40 p-3" data-testid="reauth">
              <div className="mb-2 text-sm font-medium">{a.reauthTitle}</div>
              <label className="block text-sm"><span className="mb-1 block text-mute">{a.reauthText}</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label={a.password} data-testid="reauth-password"
                  className="w-full rounded border border-line px-3 py-2 outline-none focus:border-red" /></label>
              {hasCode && (
                <label className="mt-2 block text-sm"><span className="mb-1 block text-mute">{a.code}</span>
                  <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" data-testid="reauth-code"
                    className="w-full rounded border border-line px-3 py-2 outline-none focus:border-red" /></label>
              )}
            </div>
          )}
          {error && <p className="mb-3 rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded border border-line px-4 py-2 text-sm hover:bg-band">{d.cancel}</button>
            <button disabled={!ready || pending} data-testid="confirm-button"
              className={cn("rounded bg-red px-4 py-2 text-sm font-medium text-white", (!ready || pending) && "opacity-50")}>{pending ? d.working : confirmLabel}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
