// Budget setup suggestions (pure): which products to show standalone, category groups, and rental hints.
import type { BudgetSetup } from "./budget-builder";
import type { SalesProductRow } from "./sales";

export interface RentalHint { key: string; reason: "name" | "location" | "analytic" | "account" }

const IGNORED = new Set(["", "No product"]); // always go to Others, never picked, grouped or hinted
const RENTAL_NAME = /\b(rent|rental|lease|hire)\b|إيجار|ايجار|تأجير/i;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function emptySetup(): BudgetSetup {
  return { products: [], groups: [], streams: { rental: [] }, expenses: { merged: [], excluded: [] } };
}

/** Lowercase, runs of anything but letters, marks and digits become "-", trimmed of "-". Arabic letters stay. */
function slug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/**
 * Suggests a setup from this year's product rows: the `top` products by total amount (default 15), one group per
 * category, and rental hints (by name, by location products and by revenue accounts). `coverage` is the share of
 * all amounts that the ticked top products make up.
 */
export function suggestSetup(
  products: SalesProductRow[],
  opts: { top?: number; rentalProducts?: string[]; rentalAccounts?: string[] } = {},
): { setup: BudgetSetup; hints: RentalHint[]; coverage: number } {
  const totals = new Map<string, number>();
  const categories = new Map<string, Set<string>>(); // category text -> its products, first-appearance order
  let all = 0;
  for (const r of products) {
    all += r.a;
    if (IGNORED.has(r.r)) continue;
    totals.set(r.r, (totals.get(r.r) ?? 0) + r.a);
    if (r.g) {
      let set = categories.get(r.g);
      if (!set) categories.set(r.g, (set = new Set()));
      set.add(r.r);
    }
  }

  const ranked = [...totals].sort((x, y) => y[1] - x[1] || cmp(x[0], y[0])).map(([name]) => name);
  const picked = ranked.slice(0, opts.top ?? 15);
  const topSum = picked.reduce((t, name) => t + (totals.get(name) ?? 0), 0);
  const coverage = all !== 0 ? r4(topSum / all) : 0;

  const used = new Set<string>();
  let blank = 0;
  const groups = [...categories].map(([name, members]) => {
    const base = slug(name) || `g${++blank}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return { id, name, products: [...members].sort(cmp), customers: [] as string[] };
  });

  // location first, then account, then name: a product gets the first reason that matches it
  const hints = new Map<string, RentalHint>();
  const hint = (key: string, reason: RentalHint["reason"]) => { if (!hints.has(key)) hints.set(key, { key, reason }); };
  for (const p of opts.rentalProducts ?? []) if (!IGNORED.has(p)) hint(p, "location");
  for (const a of opts.rentalAccounts ?? []) if (a) hint(`acct:${a}`, "account");
  for (const p of totals.keys()) if (RENTAL_NAME.test(p)) hint(p, "name");
  const hintList = [...hints.values()].sort((x, y) => cmp(x.key, y.key));

  return {
    setup: {
      products: picked,
      groups,
      streams: { rental: hintList.map((h) => h.key) },
      expenses: { merged: [], excluded: [] },
    },
    hints: hintList,
    coverage,
  };
}

/** Setup with every array sorted and groups by id, so that only real differences show. */
function normalise(s: BudgetSetup) {
  return {
    products: [...s.products].sort(cmp),
    groups: s.groups
      .map((g) => ({ id: g.id, name: g.name, products: [...g.products].sort(cmp), customers: [...g.customers].sort(cmp) }))
      .sort((a, b) => cmp(a.id, b.id)),
    streams: { rental: [...s.streams.rental].sort(cmp) },
    expenses: {
      merged: s.expenses.merged
        .map((m) => ({ id: m.id, name: m.name, accounts: [...m.accounts].sort(cmp) }))
        .sort((a, b) => cmp(a.id, b.id)),
      excluded: [...s.expenses.excluded].sort(cmp),
    },
  };
}

/** True when the setup a budget version was saved with differs from the current setup (no version: no drift). */
export function setupDrift(versionSetup: BudgetSetup | null, current: BudgetSetup): boolean {
  if (!versionSetup) return false;
  return JSON.stringify(normalise(versionSetup)) !== JSON.stringify(normalise(current));
}

/** The setup as saved: group and merged-expense names trimmed; null when a group has no name left. */
export function cleanSetup(s: BudgetSetup): BudgetSetup | null {
  const groups = s.groups.map((g) => ({ ...g, name: g.name.trim() }));
  if (groups.some((g) => !g.name)) return null;
  return { ...s, groups, expenses: { ...s.expenses, merged: s.expenses.merged.map((m) => ({ ...m, name: m.name.trim() })) } };
}
