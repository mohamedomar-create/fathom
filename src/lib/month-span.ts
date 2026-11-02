/** "Jan 2023 – Sep 2023": the first and last of some YYYY-MM months, whatever order they come in. */
export function monthSpan(ps: readonly string[], label: (p: string) => string): string {
  if (!ps.length) return "–";
  const s = [...ps].sort();
  return s.length === 1 ? label(s[0]) : `${label(s[0])} – ${label(s[s.length - 1])}`;
}
