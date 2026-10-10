"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import { MIN_PASSWORD, PASSWORD_HINT, passwordProblem } from "@/lib/password";
import { createClient } from "@/lib/supabase/client";
import { deleteAccount, leaveOrganisation, saveName } from "./actions";

export interface OrgInfo { id: string; name: string; role: string; members: number; otherAdmins: number }

const field = "w-full rounded border border-line px-3 py-2 outline-none focus:border-green";
type Msg = { ok: boolean; text: string } | null;
const Note = ({ msg }: { msg: Msg }) => msg && <span className={cn("text-sm", msg.ok ? "text-green-d" : "text-red")} role="status">{msg.text}</span>;

export function NameForm({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveName(name); setMsg(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error ?? "Could not save." }); }); }}>
      <label className="min-w-60 flex-1"><span className="label mb-1 block">Your name</span><input className={field} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
      <button disabled={pending} className="rounded bg-green-d px-4 py-2 font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save"}</button>
      <Note msg={msg} />
    </form>
  );
}

export function PasswordForm() {
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw) ?? (pw !== again ? "The two passwords don't match." : null);
    if (problem) { setMsg({ ok: false, text: problem }); return; }
    setBusy(true); setMsg(null);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: /session|reauth/i.test(error.message) ? "For your security, sign out and sign in again, then change your password." : error.message }); return; }
    setPw(""); setAgain("");
    setMsg({ ok: true, text: "Password changed." });
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label><span className="label mb-1 block">New password</span><input type="password" className={field} value={pw} onChange={(e) => setPw(e.target.value)} minLength={MIN_PASSWORD} required autoComplete="new-password" /></label>
      <label><span className="label mb-1 block">Repeat it</span><input type="password" className={field} value={again} onChange={(e) => setAgain(e.target.value)} minLength={MIN_PASSWORD} required autoComplete="new-password" /></label>
      <p className="text-xs text-mute sm:col-span-2">{PASSWORD_HINT}</p>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={busy} className="rounded bg-green-d px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? "Saving…" : "Change password"}</button>
        <Note msg={msg} />
      </div>
    </form>
  );
}

export function LeaveOrg({ org }: { org: OrgInfo }) {
  const router = useRouter();
  return (
    <ConfirmDialog title={`Leave ${org.name}?`} confirmLabel="Leave organisation" testId="leave-org-dialog"
      onConfirm={async () => { const r = await leaveOrganisation(org.id); if (!r.ok) return r.error ?? "Could not leave."; router.refresh(); }}
      trigger={<button className="rounded border border-line px-3 py-1.5 text-sm hover:bg-band">Leave</button>}>
      <p>You will lose access to {org.name}&apos;s companies and reports straight away. An admin can invite you again later.</p>
    </ConfirmDialog>
  );
}

export function DeleteAccount({ email, orgs }: { email: string; orgs: OrgInfo[] }) {
  const alone = orgs.filter((o) => o.members === 1);
  const blocking = orgs.filter((o) => o.members > 1 && o.role === "admin" && o.otherAdmins === 0);
  return (
    <>
      <p className="mb-3 text-sm text-mute">Permanently deletes your sign-in and profile. Organisations where you are the only member are deleted with all their companies and data.</p>
      {blocking.length > 0 && (
        <p className="mb-3 rounded bg-band px-3 py-2 text-sm">
          You are the only admin of {blocking.map((o) => o.name).join(", ")}. Make someone else an admin there first (User management), or delete the organisation.
        </p>
      )}
      <ConfirmDialog title="Delete your account?" confirmLabel="Delete my account" typeToConfirm={email} typeLabel="Type your email" testId="delete-account-dialog"
        onConfirm={async (typed) => { const r = await deleteAccount(typed); if (!r.ok) return r.error ?? "Could not delete your account."; }}
        trigger={<button disabled={blocking.length > 0} className="rounded border border-red px-4 py-2 text-sm text-red hover:bg-red-bg disabled:opacity-50" data-testid="delete-account">Delete my account</button>}>
        <p>This permanently deletes your account <strong className="break-all">{email}</strong>.</p>
        {alone.length > 0
          ? <p>These organisations have no other members and will be deleted with every company, report and shared link in them: <strong>{alone.map((o) => o.name).join(", ")}</strong>.</p>
          : <p>Your organisations have other members, so their companies stay; you simply lose access.</p>}
        <p className="text-mute">Download anything you need first. This cannot be undone.</p>
      </ConfirmDialog>
    </>
  );
}
