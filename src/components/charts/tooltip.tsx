"use client";
/** Absolutely-positioned tooltip inside a relative chart container. x/y are percentages of the container. */
export function ChartTip({ x, y, children, show }: { x: number; y: number; children: React.ReactNode; show: boolean }) {
  if (!show) return null;
  const flip = x > 62;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-line bg-white/97 px-3 py-2 text-xs shadow-lg"
      style={{ left: `${x}%`, top: `${y}%`, transform: `translate(${flip ? "calc(-100% - 12px)" : "12px"}, -50%)` }}
    >
      {children}
    </div>
  );
}
