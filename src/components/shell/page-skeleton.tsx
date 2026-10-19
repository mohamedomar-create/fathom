/** Shown at once while a page's figures load: the shape of the page, so nothing jumps when they arrive. */
export function PageSkeleton({ tiles = 3, label = "Loading" }: { tiles?: number; label?: string }) {
  return (
    <div className="animate-pulse py-8" aria-busy="true" aria-label={label} data-testid="page-skeleton">
      <div className="mb-2 h-4 w-32 rounded bg-band" />
      <div className="mb-6 h-8 w-72 rounded bg-band" />
      <div className={tiles === 4 ? "grid gap-4 sm:grid-cols-4" : "grid gap-4 sm:grid-cols-3"}>
        {Array.from({ length: tiles }, (_, i) => <div key={i} className="h-28 rounded-lg bg-band" />)}
      </div>
      <div className="mt-6 h-72 rounded-lg bg-band" />
    </div>
  );
}
