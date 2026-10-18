// Two companies of the same books (one synced from Odoo, one from uploads) side by side: each class's total in every
// month both hold. Differences of 1 EGP or less are rounding.

export interface BookDiff { period: string; cls: string; here: number; there: number; diff: number }

const totals = (accounts: { cls: string; amounts: Record<string, number> }[]) => {
  const out = new Map<string, Map<string, number>>();
  for (const a of accounts) for (const [p, v] of Object.entries(a.amounts)) {
    const m = out.get(p) ?? new Map<string, number>();
    m.set(a.cls, (m.get(a.cls) ?? 0) + v);
    out.set(p, m);
  }
  return out;
};

export function compareBooks(here: { cls: string; amounts: Record<string, number> }[], there: { cls: string; amounts: Record<string, number> }[]): { months: string[]; diffs: BookDiff[] } {
  const a = totals(here), b = totals(there);
  const months = [...a.keys()].filter((p) => b.has(p)).sort();
  const diffs: BookDiff[] = [];
  for (const p of months) {
    const x = a.get(p)!, y = b.get(p)!;
    for (const cls of new Set([...x.keys(), ...y.keys()])) {
      const h = Math.round((x.get(cls) ?? 0) * 100) / 100, t = Math.round((y.get(cls) ?? 0) * 100) / 100;
      if (Math.abs(h - t) > 1) diffs.push({ period: p, cls, here: h, there: t, diff: Math.round((h - t) * 100) / 100 });
    }
  }
  return { months, diffs: diffs.sort((u, v) => Math.abs(v.diff) - Math.abs(u.diff)) };
}
