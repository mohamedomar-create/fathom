"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/cn";
import { MIN_PASSWORD, passwordHint, passwordProblem } from "@/lib/password";
import { useDict, useLang } from "@/lib/i18n/context";
import { createClient } from "@/lib/supabase/client";
import { deleteAccount, leaveOrganisation, saveName } from "./actions";

export interface OrgInfo { id: string; name: string; role: string; members: number; otherAdmins: number }

const field = "w-full rounded border border-line px-3 py-2 outline-none focus:border-brand";
type Msg = { ok: boolean; text: string } | null;
const Note = ({ msg }: { msg: Msg }) => msg && <span className={cn("text-sm", msg.ok ? "text-green-d" : "text-red")} role="status">{msg.text}</span>;

export function NameForm({ initial }: { initial: string }) {
  const d = useDict().account;
  const [name, setName] = useState(initial);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await saveName(name); setMsg(r.ok ? { ok: true, text: d.saved } : { ok: false, text: r.error ?? d.couldNotSave }); }); }}>
      <label className="min-w-60 flex-1"><span className="label mb-1 block">{d.yourName}</span><input className={field} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
      <button disabled={pending} className="rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50">{pending ? d.saving : d.save}</button>
      <Note msg={msg} />
    </form>
  );
}

export function PasswordForm() {
  const d = useDict().account;
  const lang = useLang();
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(pw, lang) ?? (pw !== again ? d.mismatch : null);
    if (problem) { setMsg({ ok: false, text: problem }); return; }
    setBusy(true); setMsg(null);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: /session|reauth/i.test(error.message) ? d.reauth : error.message }); return; }
    setPw(""); setAgain("");
    setMsg({ ok: true, text: d.passwordChanged });
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
      <label><span className="label mb-1 block">{d.newPassword}</span><input type="password" className={field} value={pw} onChange={(e) => setPw(e.target.value)} minLength={MIN_PASSWORD} required autoComplete="new-password" /></label>
      <label><span className="label mb-1 block">{d.repeat}</span><input type="password" className={field} value={again} onChange={(e) => setAgain(e.target.value)} minLength={MIN_PASSWORD} required autoComplete="new-password" /></label>
      <p className="text-xs text-mute sm:col-span-2">{passwordHint(lang)}</p>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={busy} className="rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50">{busy ? d.saving : d.changePassword}</button>
        <Note msg={msg} />
      </div>
    </form>
  );
}

export function LeaveOrg({ org }: { org: OrgInfo }) {
  const router = useRouter();
  const d = useDict().account;
  return (
    <ConfirmDialog title={d.leaveTitle(org.name)} confirmLabel={d.leaveConfirm} testId="leave-org-dialog"
      onConfirm={async () => { const r = await leaveOrganisation(org.id); if (!r.ok) return r.error ?? d.couldNotLeave; router.refresh(); }}
      trigger={<button className="rounded border border-line px-3 py-1.5 text-sm hover:bg-band">{d.leave}</button>}>
      <p>{d.leaveBody(org.name)}</p>
    </ConfirmDialog>
  );
}

export function DeleteAccount({ email, orgs }: { email: string; orgs: OrgInfo[] }) {
  const d = useDict().account;
  const alone = orgs.filter((o) => o.members === 1);
  const blocking = orgs.filter((o) => o.members > 1 && o.role === "admin" && o.otherAdmins === 0);
  return (
    <>
      <p className="mb-3 text-sm text-mute">{d.deleteHelp}</p>
      {blocking.length > 0 && (
        <p className="mb-3 rounded bg-band px-3 py-2 text-sm">
          {d.deleteBlocked(blocking.map((o) => o.name).join(", "))}
        </p>
      )}
      <ConfirmDialog title={d.deleteTitle} confirmLabel={d.deleteMine} typeToConfirm={email} typeLabel={d.typeEmail} testId="delete-account-dialog"
        onConfirm={async (typed) => { const r = await deleteAccount(typed); if (!r.ok) return r.error ?? d.couldNotDelete; }}
        trigger={<button disabled={blocking.length > 0} className="rounded border border-red px-4 py-2 text-sm text-red hover:bg-red-bg disabled:opacity-50" data-testid="delete-account">{d.deleteMine}</button>}>
        <p>{d.deleteBody} <strong className="break-all">{email}</strong>.</p>
        {alone.length > 0
          ? <p>{d.deleteAlone} <strong>{alone.map((o) => o.name).join(", ")}</strong>.</p>
          : <p>{d.deleteShared}</p>}
        <p className="text-mute">{d.deleteLast}</p>
      </ConfirmDialog>
    </>
  );
}
