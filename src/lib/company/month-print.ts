/**
 * Saving sales and expense lines again without a trip to Data health. Each month's lines get one fingerprint: a SHA-256
 * of their line hashes, sorted. The database builds the same one from what it holds (line_months, migration 0021), so
 * "Add new and changed" adds the months that are new, replaces the ones that changed and leaves identical ones alone.
 * Lines are compared as the database stores them (text cut to its column lengths, amounts in cents). A difference in
 * how the two sides build a fingerprint can only make an unchanged month look changed, and so be replaced with the
 * same lines: never the other way round.
 */
export type SaveMode = "new" | "changed" | "months" | "all";
export type MonthPrint = { n: number; print: string };

const SEP = "\u001f";
const int = (x: number | null | undefined, scale: number) => (x === null || x === undefined ? "" : String(Math.round(x * scale)));

// Simple mode's columns (channel, paid, payment day) join a line's text only when it carries one: Full-mode lines keep
// exactly the fingerprint they had, and a sale or expense that became paid makes its month "changed".
const paidPart = (l: { paid?: boolean | null; paidOn?: string | null }) => [l.paid === undefined || l.paid === null ? "" : String(l.paid), l.paidOn ?? ""];

export function salesLineText(l: { day: string | null; doc: string; customer: string; product: string; qty: number | null; amount: number; cost: number | null; channel?: string; paid?: boolean | null; paidOn?: string | null }): string {
  const base = [l.day ?? "", l.doc.slice(0, 80), l.customer.slice(0, 200), l.product.slice(0, 300), int(l.amount, 100), int(l.qty, 10_000), int(l.cost, 100)];
  const simple = !!l.channel || (l.paid !== undefined && l.paid !== null) || !!l.paidOn;
  return (simple ? [...base, (l.channel ?? "").slice(0, 120), ...paidPart(l)] : base).join(SEP);
}

export function expenseLineText(l: { day: string | null; doc: string; supplier: string; account: string; label: string; amount: number; paid?: boolean | null; paidOn?: string | null }): string {
  const base = [l.day ?? "", l.doc.slice(0, 80), l.supplier.slice(0, 200), l.account.slice(0, 200), l.label.slice(0, 200), int(l.amount, 100)];
  const simple = (l.paid !== undefined && l.paid !== null) || !!l.paidOn;
  return (simple ? [...base, ...paidPart(l)] : base).join(SEP);
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** Each month's line count and fingerprint. */
export async function monthPrints<T extends { period: string }>(lines: T[], text: (l: T) => string): Promise<Record<string, MonthPrint>> {
  const hashes = await Promise.all(lines.map((l) => sha256(text(l))));
  const by = new Map<string, string[]>();
  lines.forEach((l, i) => by.set(l.period, [...(by.get(l.period) ?? []), hashes[i]]));
  const out: Record<string, MonthPrint> = {};
  for (const [p, hs] of by) out[p] = { n: hs.length, print: await sha256(hs.sort().join("")) };
  return out;
}

/** Which of the file's months to save for each way of saving, and what happens to each. */
export function planSave(file: Record<string, MonthPrint>, stored: Record<string, MonthPrint>, mode: SaveMode) {
  const months = Object.keys(file).sort();
  const added = months.filter((p) => !stored[p]);
  const differs = months.filter((p) => stored[p] && stored[p].print !== file[p].print);
  const same = months.filter((p) => stored[p] && stored[p].print === file[p].print);
  if (mode === "new") return { periods: added, added, changed: [] as string[], unchanged: [] as string[], replaceAll: false };
  if (mode === "changed") return { periods: [...added, ...differs].sort(), added, changed: differs, unchanged: same, replaceAll: false };
  return { periods: months, added, changed: [...differs, ...same].sort(), unchanged: [] as string[], replaceAll: mode === "all" };
}
