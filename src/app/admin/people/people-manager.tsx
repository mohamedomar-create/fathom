"use client";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelInvite, invite, removeMember, setRole } from "../actions";

type Role = "admin" | "editor" | "viewer";
export function PeopleManager({ orgId, me, people, invites }: { orgId: string; me: string; people: { user_id: string; role: Role; email: string; name: string | null }[]; invites: { id: string; email: string; role: Role }[] }) {
  const [email, setEmail] = useState("");
  const [role, setR] = useState<Role>("editor");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (f: () => Promise<{ ok: boolean; error?: string }>, ok: string) => start(async () => { const r = await f(); setMsg(r.ok ? ok : r.error ?? "Error"); });
  return (
    <div className="space-y-8">
      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); act(() => invite(orgId, email, role), `Invitation saved for ${email}. Ask them to sign up at this site with that address.`); setEmail(""); }}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="colleague@firm.com" className="min-w-64 flex-1 rounded border border-line px-3 py-2" />
        <select value={role} onChange={(e) => setR(e.target.value as Role)} className="rounded border border-line px-2"><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select>
        <button disabled={pending} className="rounded bg-brand-d px-4 py-2 font-medium text-white">Invite a person</button>
      </form>
      {msg && <p className="text-sm text-green-d">{msg}</p>}
      <table className="tbl text-sm">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.user_id} className="row">
              <td>{p.name ?? "–"}{p.user_id === me && <span className="ml-2 text-xs text-mute">(you)</span>}</td>
              <td className="text-left">{p.email}</td>
              <td><select disabled={p.user_id === me} value={p.role} onChange={(e) => act(() => setRole(orgId, p.user_id, e.target.value as Role), "Role updated.")} className="rounded border border-line px-1.5 py-0.5 uppercase text-xs"><option value="admin">admin</option><option value="editor">editor</option><option value="viewer">viewer</option></select></td>
              <td>{p.user_id !== me && (
                <ConfirmDialog title={`Remove ${p.email}?`} confirmLabel="Remove" onConfirm={async () => { const r = await removeMember(orgId, p.user_id); if (!r.ok) return r.error ?? "Could not remove."; setMsg("Removed."); }}
                  trigger={<button className="text-xs text-red hover:underline">Remove</button>}>
                  <p>{p.name ?? p.email} will lose access to this organisation&apos;s companies and reports straight away. You can invite them again later.</p>
                </ConfirmDialog>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {invites.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-light">Pending invites</h2>
          <table className="tbl text-sm"><tbody>
            {invites.map((i) => <tr key={i.id} className="row"><td>{i.email}</td><td className="uppercase text-xs">{i.role}</td><td><button onClick={() => act(() => cancelInvite(i.id), "Invite cancelled.")} className="text-xs text-red hover:underline">Cancel</button></td></tr>)}
          </tbody></table>
        </div>
      )}
    </div>
  );
}
