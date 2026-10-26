"use client";
import Link from "next/link";
import { safeNext } from "@/lib/safe-redirect";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { APP_TAGLINE } from "@/lib/brand";
import { Logo } from "@/components/shell/logo";
import { LangSwitch } from "@/components/shell/lang-switch";
import { createClient } from "@/lib/supabase/client";
import { needsCode, verifyCode } from "@/lib/auth/mfa";
import { cn } from "@/lib/cn";
import { MIN_PASSWORD, passwordHint, passwordProblem } from "@/lib/password";
import { useDict, useLang } from "@/lib/i18n/context";
import type { Dict } from "@/lib/i18n";

/** Supabase's own sign-in messages, in the chosen language when we know them. */
function authError(e: unknown, d: Dict["auth"]): string {
  const m = e instanceof Error ? e.message : "";
  if (/invalid login credentials/i.test(m)) return d.badLogin;
  if (/email not confirmed/i.test(m)) return d.notConfirmed;
  if (/rate limit|too many/i.test(m)) return d.tooMany;
  return m || d.wrong;
}

type Mode = "signin" | "signup";

export function LoginForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const lang = useLang();
  const d = useDict().auth;
  const rawNext = sp.get("next");
  const next = safeNext(rawNext);
  const [mode, setMode] = useState<Mode>(sp.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(
    sp.get("error") ? { tone: "bad", text: d.badLink } : sp.get("reason") === "idle" ? { tone: "ok", text: d.idleOut } : null);
  // After the password (or an email link), people with two-step sign-in type their code.
  const [step, setStep] = useState<"form" | "code">(sp.get("mfa") === "1" ? "code" : "form");
  const [code, setCode] = useState("");

  const supabase = createClient();
  const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (await needsCode(supabase)) { setStep("code"); return; }
        router.replace(next);
        router.refresh();
      } else {
        const problem = passwordProblem(password, lang);
        if (problem) { setMsg({ tone: "bad", text: problem }); return; }
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo, data: { full_name: name, org_name: org } } });
        if (error) throw error;
        if (data.session) { router.replace(next); router.refresh(); }
        else setMsg({ tone: "ok", text: d.checkInbox });
      }
    } catch (err) {
      setMsg({ tone: "bad", text: authError(err, d) });
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const problem = await verifyCode(supabase, code);
    setBusy(false);
    if (problem) { setMsg({ tone: "bad", text: d.codeWrong }); return; }
    router.replace(next);
    router.refresh();
  }

  async function magic() {
    if (!email) { setMsg({ tone: "bad", text: d.emailFirst }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
    setBusy(false);
    setMsg(error ? { tone: "bad", text: authError(error, d) } : { tone: "ok", text: d.linkSent });
  }

  async function reset() {
    if (!email) { setMsg({ tone: "bad", text: d.emailFirst }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset` });
    setBusy(false);
    setMsg(error ? { tone: "bad", text: authError(error, d) } : { tone: "ok", text: d.resetSent });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-bar p-12 text-white lg:flex">
        <Link href="/" className="text-lg"><Logo tone="dark" /></Link>
        <div>
          <h2 className="max-w-md text-4xl font-light leading-tight">{d.heroTitle}</h2>
          <p className="mt-4 max-w-md text-[#bbb]">{d.heroText(APP_TAGLINE)}</p>
        </div>
        <Link href="/demo/summary" className="text-sm text-brand hover:underline">{d.exploreDemo}</Link>
      </div>
      <div className="relative flex items-center justify-center p-6">
        <LangSwitch className="absolute end-4 top-4 text-sm text-mute hover:bg-band" />
        {step === "code" ? (
          <form onSubmit={submitCode} className="w-full max-w-sm" data-testid="mfa-form">
            <h1 className="mb-2 text-2xl font-light">{d.codeTitle}</h1>
            <p className="mb-5 text-sm text-mute">{d.codeText}</p>
            <Field label={d.code} value={code} onChange={setCode} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus data-testid="mfa-code" />
            {msg && <p className="mb-3 rounded bg-red-bg px-3 py-2 text-sm text-red" role="status">{msg.text}</p>}
            <button disabled={busy} className="w-full rounded bg-brand-d px-4 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-60">{busy ? d.wait : d.verify}</button>
          </form>
        ) : (
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <Link href="/" className="mb-8 block text-lg lg:hidden"><Logo /></Link>
          <h1 className="mb-5 text-2xl font-light">{mode === "signin" ? d.titleSignin : d.titleSignup}</h1>
          <div className="mb-6 flex gap-1 rounded-md bg-band p-1 text-sm">
            {(["signin", "signup"] as Mode[]).map((m) => (
              <button type="button" key={m} onClick={() => { setMode(m); setMsg(null); }}
                className={cn("flex-1 rounded px-3 py-1.5", mode === m ? "bg-white font-semibold shadow-sm" : "text-mute")}>
                {m === "signin" ? d.signin : d.signup}
              </button>
            ))}
          </div>
          {mode === "signup" && (
            <>
              <Field label={d.name} value={name} onChange={setName} autoComplete="name" />
              <Field label={d.org} value={org} onChange={setOrg} placeholder={d.orgPlaceholder} />
            </>
          )}
          <Field label={d.email} type="email" value={email} onChange={setEmail} autoComplete="email" required />
          <Field label={d.password} type="password" value={password} onChange={setPassword} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "signup" ? MIN_PASSWORD : undefined} />
          {mode === "signup" && <p className="-mt-3 mb-4 text-xs text-mute">{passwordHint(lang)}</p>}
          {msg && <p className={cn("mb-3 rounded px-3 py-2 text-sm", msg.tone === "ok" ? "bg-green-bg text-green-d" : "bg-red-bg text-red")} role="status">{msg.text}</p>}
          <button disabled={busy} className="w-full rounded bg-brand-d px-4 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-60">
            {busy ? d.wait : mode === "signin" ? d.signin : d.signup}
          </button>
          {mode === "signup" && (
            <p className="mt-3 text-center text-xs text-mute" data-testid="signup-legal">
              {d.agree[0]}<Link href="/terms" className="underline">{d.agree[1]}</Link>{d.agree[2]}<Link href="/privacy" className="underline">{d.agree[3]}</Link>{d.agree[4]}
            </p>
          )}
          {mode === "signin" && (
            <div className="mt-3 flex justify-between gap-3 text-sm">
              <button type="button" onClick={magic} disabled={busy} className="text-mute hover:text-ink">{d.magic}</button>
              <button type="button" onClick={reset} disabled={busy} className="text-mute hover:text-ink">{d.forgot}</button>
            </div>
          )}
          <p className="mt-8 text-center text-xs text-mute">
            {d.justLooking} <Link href="/demo/summary" className="text-brand-d underline">{d.openDemo}</Link>
          </p>
        </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="mb-4 block">
      <span className="label mb-1 block">{label}</span>
      <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-line px-3 py-2 outline-none focus:border-brand" />
    </label>
  );
}
