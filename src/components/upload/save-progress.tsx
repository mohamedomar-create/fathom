"use client";

/** How far a save has got: what is being saved and how many of how many, as a bar (the page stays usable meanwhile). */
export function SaveProgress({ what, done, of }: { what: string; done: number; of: number }) {
  const pct = of ? Math.min(100, Math.round((done / of) * 100)) : 0;
  return (
    <div className="my-3 max-w-xl" data-testid="save-progress" role="status" aria-live="polite">
      <div className="mb-1 flex justify-between text-[13px] text-mute"><span>{what}</span><span>{done.toLocaleString("en-US")} of {of.toLocaleString("en-US")}</span></div>
      <div className="h-2 overflow-hidden rounded bg-band"><div className="h-full rounded bg-brand-d transition-[width] duration-200" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
