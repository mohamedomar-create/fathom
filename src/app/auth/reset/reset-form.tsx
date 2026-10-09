"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";

export function ResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) { setMsg({ tone: "bad", text: error.message.includes("session") ? "This reset link has expired. Request a new one from the sign-in page." : error.message }); return; }
    setMsg({ tone: "ok", text: "Password updated. Taking you to your companies…" });
    router.replace("/companies");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm">
      <h1 className="mb-6 text-2xl font-light">Set a new password</h1>
      <label className="mb-4 block"><span className="label mb-1 block">New password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password"
          className="w-full rounded border border-line px-3 py-2 outline-none focus:border-green" /></label>
      {msg && <p className={cn("mb-3 rounded px-3 py-2 text-sm", msg.tone === "ok" ? "bg-green-bg text-green-d" : "bg-red-bg text-red")} role="status">{msg.text}</p>}
      <button disabled={busy} className="w-full rounded bg-green-d px-4 py-2.5 font-medium text-white disabled:opacity-60">{busy ? "Saving…" : "Save password"}</button>
      <p className="mt-6 text-center text-sm"><Link href="/login" className="text-mute underline">Back to sign in</Link></p>
    </form>
  );
}
