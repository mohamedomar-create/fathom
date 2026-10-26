"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import { useDict } from "@/lib/i18n/context";

type Factor = { id: string; status: string };
/** Supabase gives the QR code as SVG text or as an image address. */
const qrSrc = (qr: string) => (qr.startsWith("data:") ? qr : `data:image/svg+xml;utf8,${encodeURIComponent(qr)}`);

/** Two-step sign-in with an authenticator app: scan, type the first code, done. Turning it off asks for the password and a code. */
export function MfaSetup() {
  const t = useDict().access;
  const router = useRouter();
  const [factor, setFactor] = useState<Factor | null | undefined>(undefined);
  const [enrol, setEnrol] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const load = async () => {
    const { data } = await createClient().auth.mfa.listFactors();
    setFactor((data?.totp ?? []).find((f) => f.status === "verified") ?? null);
  };
  useEffect(() => {
    let live = true;
    void createClient().auth.mfa.listFactors().then(({ data }) => { if (live) setFactor((data?.totp ?? []).find((f) => f.status === "verified") ?? null); });
    return () => { live = false; };
  }, []);
  const begin = () => start(async () => {
    setMsg(null);
    const supabase = createClient();
    // A setup left half-way is removed first, so a new one can start.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `iReport ${new Date().toISOString().slice(0, 10)}` });
    if (error || !data) { setMsg({ ok: false, text: error?.message ?? t.codeWrong }); return; }
    setEnrol({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  });
  const confirm = () => start(async () => {
    if (!enrol) return;
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: enrol.id, code: code.replace(/\s/g, "") });
    if (error) { setMsg({ ok: false, text: t.codeWrong }); return; }
    setEnrol(null); setCode(""); setMsg({ ok: true, text: t.mfaDone });
    await load();
    router.refresh();
  });
  if (factor === undefined) return null;
  return (
    <div data-testid="mfa-setup">
      <p className="mb-3 text-sm" data-testid="mfa-status">{factor ? t.mfaOn : t.mfaOff}</p>
      {!factor && !enrol && <button disabled={pending} onClick={begin} data-testid="mfa-start" className="rounded bg-brand-d px-4 py-2 text-sm text-white disabled:opacity-50">{t.mfaStart}</button>}
      {enrol && (
        <div className="space-y-3">
          <p className="text-sm">{t.mfaScan}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc(enrol.qr)} alt="" width={180} height={180} className="rounded border border-line bg-white p-2" />
          <p className="text-sm">{t.mfaKey}: <code className="break-all rounded bg-band px-1.5 py-0.5" data-testid="mfa-secret">{enrol.secret}</code></p>
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); confirm(); }}>
            <label className="block text-sm"><span className="mb-1 block text-mute">{t.mfaConfirm}</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required data-testid="mfa-confirm-code"
                className="w-40 rounded border border-line px-3 py-2" /></label>
            <button disabled={pending} data-testid="mfa-confirm" className="rounded bg-brand-d px-4 py-2 text-sm text-white disabled:opacity-50">{t.mfaStart}</button>
          </form>
        </div>
      )}
      {factor && (
        <ConfirmDialog reauth title={t.mfaRemoveTitle} confirmLabel={t.mfaRemove} testId="mfa-remove-dialog"
          onConfirm={async () => {
            const { error } = await createClient().auth.mfa.unenroll({ factorId: factor.id });
            if (error) return error.message;
            await load();
            router.refresh();
          }}
          trigger={<button className="text-sm text-red hover:underline" data-testid="mfa-remove">{t.mfaRemove}</button>}>
          <p>{t.mfaRemoveText}</p>
        </ConfirmDialog>
      )}
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-green-d" : "text-red"}`}>{msg.text}</p>}
    </div>
  );
}
