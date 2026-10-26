"use client";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelInvite, invite, removeMember, resetMemberMfa, setRole, transferOwnership } from "../actions";
import { useDict, useLang } from "@/lib/i18n/context";

type Role = "admin" | "editor" | "viewer";
type Invite = { id: string; email: string; role: Role; expires_at: string; declined_at: string | null };
export function PeopleManager({ orgId, me, ownerId, people, invites }: { orgId: string; me: string; ownerId: string | null; people: { user_id: string; role: Role; email: string; name: string | null }[]; invites: Invite[] }) {
  const d = useDict().account;
  const a = useDict().access;
  const lang = useLang();
  const iOwn = ownerId === me;
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short" });
  const inviteState = (i: Invite) => i.declined_at ? a.declined : new Date(i.expires_at) <= new Date() ? a.expired : a.expires(date(i.expires_at));
  const [email, setEmail] = useState("");
  const [role, setR] = useState<Role>("editor");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (f: () => Promise<{ ok: boolean; error?: string }>, ok: string) => start(async () => { const r = await f(); setMsg(r.ok ? ok : r.error ?? d.error); });
  return (
    <div className="space-y-8">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); act(() => invite(orgId, email, role), d.invited(email)); setEmail(""); }}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@firm.com" className="min-w-64 flex-1 rounded border border-line px-3 py-2" />
        <select value={role} onChange={(e) => setR(e.target.value as Role)} className="rounded border border-line px-2"><option value="editor">{d.roles.editor}</option><option value="viewer">{d.roles.viewer}</option><option value="admin">{d.roles.admin}</option></select>
        <button disabled={pending} className="rounded bg-brand-d px-4 py-2 font-medium text-white">{d.invite}</button>
      </form>
      {msg && <p className="text-sm text-green-d">{msg}</p>}
      <table className="tbl text-sm">
        <thead><tr><th>{d.name}</th><th>{d.email}</th><th>{d.role}</th><th></th></tr></thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.user_id} className="row">
              <td>{p.name ?? "–"}{p.user_id === me && <span className="ms-2 text-xs text-mute">{d.you}</span>}
                {p.user_id === ownerId && <span className="ms-2 rounded bg-brand/15 px-1.5 py-0.5 text-[11px] text-brand-d" data-testid="owner-badge">{a.owner}</span>}</td>
              <td className="text-start">{p.email}</td>
              <td><select disabled={p.user_id === me || p.user_id === ownerId} value={p.role} onChange={(e) => act(() => setRole(orgId, p.user_id, e.target.value as Role), d.roleUpdated)} className="rounded border border-line px-1.5 py-0.5 uppercase text-xs"><option value="admin">{d.roles.admin}</option><option value="editor">{d.roles.editor}</option><option value="viewer">{d.roles.viewer}</option></select></td>
              <td className="space-x-3 whitespace-nowrap">
                {iOwn && p.user_id !== me && p.role === "admin" && (
                  <ConfirmDialog reauth title={a.handOverTitle(p.name ?? p.email)} confirmLabel={a.handOver} testId="hand-over-dialog"
                    onConfirm={async () => { const r = await transferOwnership(orgId, p.user_id); if (!r.ok) return r.error ?? d.error; setMsg(a.owner); }}
                    trigger={<button className="text-xs text-brand-d hover:underline" data-testid="hand-over">{a.handOver}</button>}>
                    <p>{a.handOverText}</p>
                  </ConfirmDialog>
                )}
                {iOwn && p.user_id !== me && (
                  <ConfirmDialog reauth title={a.resetMfaTitle(p.name ?? p.email)} confirmLabel={a.resetMfa}
                    onConfirm={async () => { const r = await resetMemberMfa(orgId, p.user_id); if (!r.ok) return r.error ?? d.error; setMsg(a.resetMfa); }}
                    trigger={<button className="text-xs text-mute hover:underline">{a.resetMfa}</button>}>
                    <p>{a.resetMfaText}</p>
                  </ConfirmDialog>
                )}
                {p.user_id !== me && p.user_id !== ownerId && (
                <ConfirmDialog reauth title={d.removeTitle(p.email)} confirmLabel={d.remove} onConfirm={async () => { const r = await removeMember(orgId, p.user_id); if (!r.ok) return r.error ?? d.couldNotRemove; setMsg(d.removed); }}
                  trigger={<button className="text-xs text-red hover:underline">{d.remove}</button>}>
                  <p>{d.removeBody(p.name ?? p.email)}</p>
                </ConfirmDialog>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {invites.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-light">{d.pending}</h2>
          <table className="tbl text-sm"><tbody>
            {invites.map((i) => <tr key={i.id} className="row" data-testid="invite-row"><td>{i.email}</td><td className="uppercase text-xs">{d.roles[i.role]}</td>
              <td className="text-xs text-mute" data-testid="invite-state">{inviteState(i)}</td>
              <td className="space-x-3 whitespace-nowrap"><button onClick={() => act(() => invite(orgId, i.email, i.role), d.invited(i.email))} className="text-xs text-brand-d hover:underline">{a.resend}</button>
                <button onClick={() => act(() => cancelInvite(i.id), d.inviteCancelled)} className="text-xs text-red hover:underline">{d.cancelInvite}</button></td></tr>)}
          </tbody></table>
        </div>
      )}
    </div>
  );
}
