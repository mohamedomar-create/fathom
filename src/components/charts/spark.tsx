export function Sparkline({ values, color = "#7CB46B", w = 140, h = 34 }: { values: (number | null)[]; color?: string; w?: number; h?: number }) {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (v.length < 2) return <svg width={w} height={h} />;
  const lo = Math.min(...v), hi = Math.max(...v), rng = hi - lo || 1;
  const pts = values.map((x, i) => (x === null ? null : [2 + ((w - 4) * i) / (values.length - 1), h - 3 - (h - 6) * ((x - lo) / rng)])).filter(Boolean) as number[][];
  const d = "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={3} fill={color} />
    </svg>
  );
}

export function MiniPie({ p }: { p: number | null }) {
  const f = Math.max(0, Math.min(Math.abs(p ?? 0), 100)) / 100;
  let arc = null;
  if (f >= 0.999) arc = <circle cx={8} cy={8} r={7} fill="#7CB46B" />;
  else if (f > 0) {
    const a = 2 * Math.PI * f, x = 8 + 7 * Math.sin(a), y = 8 - 7 * Math.cos(a);
    arc = <path d={`M8,8 L8,1 A7,7 0 ${f > 0.5 ? 1 : 0} 1 ${x.toFixed(2)},${y.toFixed(2)} Z`} fill="#7CB46B" />;
  }
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" className="inline-block align-[-3px]" aria-hidden>
      <circle cx={8} cy={8} r={7} fill="#E7E7E3" />{arc}
    </svg>
  );
}
