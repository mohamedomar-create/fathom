"use client";
import { useEffect } from "react";
import { useDict } from "@/lib/i18n/context";

// Never shows the raw error text (it can hold database or server details); the reference lets support find the log entry.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useDict().home;
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-light">{t.errorTitle}</h1>
      <p className="mt-2 max-w-md text-mute">{t.errorText(error.digest)}</p>
      <button onClick={reset} className="mt-6 rounded bg-brand-d px-4 py-2 text-white">{t.tryAgain}</button>
    </div>
  );
}
