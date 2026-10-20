"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useDict } from "@/lib/i18n/context";

/**
 * A section's error screen: the company's menus stay, the raw error never shows (it can hold database details), and the
 * reference (Next's digest) matches the server log. Try again re-reads the server data, then re-renders the section.
 */
export function SectionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useDict().home;
  const router = useRouter();
  const [busy, start] = useTransition();
  useEffect(() => { console.error(JSON.stringify({ kind: "section-error", digest: error.digest })); }, [error]);
  return (
    <div role="alert" className="mx-auto flex min-h-[40vh] max-w-xl flex-col items-center justify-center px-6 text-center" data-testid="section-error">
      <AlertTriangle className="mb-4 h-10 w-10 text-amber" strokeWidth={1.4} />
      <h1 className="text-2xl font-light">{t.errorTitle}</h1>
      <p className="mt-2 text-mute">{t.errorText(error.digest)}</p>
      <button disabled={busy} onClick={() => start(() => { router.refresh(); reset(); })} className="mt-6 rounded bg-brand-d px-4 py-2 text-white disabled:opacity-60" data-testid="section-retry">{t.tryAgain}</button>
    </div>
  );
}
