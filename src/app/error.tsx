"use client";
import { useEffect } from "react";

// Never shows the raw error text (it can hold database or server details); the reference lets support find the log entry.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-light">Something went wrong</h1>
      <p className="mt-2 max-w-md text-mute">The page could not be shown. Try again; if it keeps happening, contact support{error.digest ? ` and quote reference ${error.digest}` : ""}.</p>
      <button onClick={reset} className="mt-6 rounded bg-green-d px-4 py-2 text-white">Try again</button>
    </div>
  );
}
