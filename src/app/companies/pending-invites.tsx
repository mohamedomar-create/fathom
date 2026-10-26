"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDict, useLang } from "@/lib/i18n/context";
import { acceptInvite, declineInvite } from "./invite-actions";

export interface PendingInvite { id: string; org_name: string; role: string; invited_by: string; expires_at: string }

/** Invitations wait here until the person accepts or declines them; nobody joins an organisation by signing in. */
export function PendingInvites({ invites }: { invites: PendingInvite[] }) {
  const t = useDict().access;
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!invites.length && !msg) return null;
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  const act = (inv: PendingInvite, accept: boolean) => start(async () => {
    const r = accept ? await acceptInvite(inv.id) : await declineInvite(inv.id);
    setMsg(r.ok ? (accept ? { ok: true, text: t.accepted(inv.org_name) } : null) : { ok: false, text: r.error });
    router.refresh();
  });
  return (
    <section className="mb-8 rounded-lg border border-brand/40 bg-brand/5 p-5" data-testid="pending-invites">
      {invites.length > 0 && <h2 className="mb-3 text-lg font-medium">{t.invitesTitle}</h2>}
      <ul className="space-y-3">
        {invites.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center gap-3 rounded border border-line bg-white p-3" data-testid="pending-invite">
            <div className="min-w-0 flex-1">
              <div>{t.invitedTo(inv.org_name, t.roles[inv.role] ?? inv.role, inv.invited_by)}</div>
              <div className="text-xs text-mute">{t.invitesExpire(date(inv.expires_at))}</div>
            </div>
            <button disabled={pending} onClick={() => act(inv, true)} data-testid="invite-accept" className="rounded bg-brand-d px-4 py-1.5 text-sm text-white disabled:opacity-50">{t.accept}</button>
            <button disabled={pending} onClick={() => act(inv, false)} data-testid="invite-decline" className="rounded border border-line px-4 py-1.5 text-sm hover:bg-band disabled:opacity-50">{t.decline}</button>
          </li>
        ))}
      </ul>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-green-d" : "text-red"}`}>{msg.text}</p>}
    </section>
  );
}
