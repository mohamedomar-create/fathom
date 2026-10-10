"use client";
import Link from "next/link";
import { safeNext } from "@/lib/safe-redirect";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { MIN_PASSWORD, PASSWORD_HINT, passwordProblem } from "@/lib/password";

type Mode = "signin" | "signup";

export function LoginForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const rawNext = sp.get("next");
  const next = safeNext(rawNext);
  const [mode, setMode] = useState<Mode>(sp.get("mode") === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(sp.get("error") ? { tone: "bad", text: "That link is invalid or has already been used. If you just confirmed your email, sign in with your password." } : null);

  const supabase = createClient();
  const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` : undefined;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
      } else {
        const problem = passwordProblem(password);
        if (problem) { setMsg({ tone: "bad", text: problem }); return; }
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo, data: { full_name: name, org_name: org } } });
        if (error) throw error;
        if (data.session) { router.replace(next); router.refresh(); }
        else setMsg({ tone: "ok", text: "Check your inbox to confirm your email address, then sign in." });
      }
    } catch (err) {
      setMsg({ tone: "bad", text: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  async function magic() {
    if (!email) { setMsg({ tone: "bad", text: "Enter your email address first." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo, shouldCreateUser: false } });
    setBusy(false);
    setMsg(error ? { tone: "bad", text: error.message } : { tone: "ok", text: "We've emailed you a sign-in link." });
  }

  async function reset() {
    if (!email) { setMsg({ tone: "bad", text: "Enter your email address first." }); return; }
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset` });
    setBusy(false);
    setMsg(error ? { tone: "bad", text: error.message } : { tone: "ok", text: "If that address has an account, we've emailed a link to set a new password." });
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-bar p-12 text-white lg:flex">
        <Link href="/" className="text-lg font-semibold">{APP_NAME}</Link>
        <div>
          <h2 className="max-w-md text-4xl font-light leading-tight">See what your Odoo numbers are really saying.</h2>
          <p className="mt-4 max-w-md text-[#bbb]">{APP_TAGLINE}. KPIs against targets, breakeven, cash-flow waterfalls, growth and goalseek — in minutes, not spreadsheets.</p>
        </div>
        <Link href="/demo/summary" className="text-sm text-green hover:underline">Explore the demo company →</Link>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm" data-testid="login-form">
          <Link href="/" className="mb-8 block text-lg font-semibold lg:hidden">{APP_NAME}</Link>
          <div className="mb-6 flex gap-1 rounded-md bg-band p-1 text-sm">
            {(["signin", "signup"] as Mode[]).map((m) => (
              <button type="button" key={m} onClick={() => { setMode(m); setMsg(null); }}
                className={cn("flex-1 rounded px-3 py-1.5", mode === m ? "bg-white font-semibold shadow-sm" : "text-mute")}>
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>
          {mode === "signup" && (
            <>
              <Field label="Your name" value={name} onChange={setName} autoComplete="name" />
              <Field label="Firm or company name" value={org} onChange={setOrg} placeholder="e.g. Nile Advisory" />
            </>
          )}
          <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
          <Field label="Password" type="password" value={password} onChange={setPassword} autoComplete={mode === "signin" ? "current-password" : "new-password"} required minLength={mode === "signup" ? MIN_PASSWORD : undefined} />
          {mode === "signup" && <p className="-mt-3 mb-4 text-xs text-mute">{PASSWORD_HINT}</p>}
          {msg && <p className={cn("mb-3 rounded px-3 py-2 text-sm", msg.tone === "ok" ? "bg-green-bg text-green-d" : "bg-red-bg text-red")} role="status">{msg.text}</p>}
          <button disabled={busy} className="w-full rounded bg-green-d px-4 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-60">
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
          {mode === "signup" && (
            <p className="mt-3 text-center text-xs text-mute" data-testid="signup-legal">
              By creating an account you agree to the <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.
            </p>
          )}
          {mode === "signin" && (
            <div className="mt-3 flex justify-between gap-3 text-sm">
              <button type="button" onClick={magic} disabled={busy} className="text-mute hover:text-ink">Email me a sign-in link</button>
              <button type="button" onClick={reset} disabled={busy} className="text-mute hover:text-ink">Forgot password?</button>
            </div>
          )}
          <p className="mt-8 text-center text-xs text-mute">
            Just looking? <Link href="/demo/summary" className="text-green-d underline">Open the demo company</Link>
          </p>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, ...rest }: { label: string; value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <label className="mb-4 block">
      <span className="label mb-1 block">{label}</span>
      <input {...rest} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-line px-3 py-2 outline-none focus:border-green" />
    </label>
  );
}
