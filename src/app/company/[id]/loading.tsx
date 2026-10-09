export default function Loading() {
  return (
    <div className="animate-pulse py-8" aria-busy="true" aria-label="Loading">
      <div className="mb-6 h-8 w-64 rounded bg-band" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-lg bg-band" />)}
      </div>
      <div className="mt-6 h-72 rounded-lg bg-band" />
    </div>
  );
}
