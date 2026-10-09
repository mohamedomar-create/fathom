"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-light">Something went wrong</h1>
      <p className="mt-2 max-w-md text-mute">{error.message || "An unexpected error occurred."}{error.digest ? ` (ref ${error.digest})` : ""}</p>
      <button onClick={reset} className="mt-6 rounded bg-green-d px-4 py-2 text-white">Try again</button>
    </div>
  );
}
