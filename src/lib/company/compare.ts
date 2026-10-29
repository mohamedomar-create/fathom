import { differs } from "@/lib/tolerance";
import { isPL } from "./build";
import { addMonths } from "@/lib/engine";
import type { ClassKey } from "@/lib/engine";

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
      if (differs(h, t)) diffs.push({ period: p, cls, here: h, there: t, diff: Math.round((h - t) * 100) / 100 });
    }
  }
  return { months, diffs: diffs.sort((u, v) => Math.abs(v.diff) - Math.abs(u.diff)) };
}

/** One account in one month where a Trial Balance and the books disagree (more than 1). */
export interface TbDiff { period: string; account: string; books: number; file: number; diff: number }
type Acct = { code: string; name: string; cls: string; amounts: Record<string, number> };

/**
 * A Trial Balance checked against the books, account by account, in every month the file covers (natural signs on both
 * sides). Accounts are matched by code, or by name when they have none; an account on one side only counts as zero on
 * the other. A month is compared only for the statement the file has for it: a Trial Balance's opening column carries
 * balances, no profit and loss. A P&L column covering several months (Odoo's year-to-date Trial Balance: `ranges` gives
 * the months it covers, ending at its period) is compared with the books' months added up. Nothing is saved: the books
 * stay as the General Ledger made them.
 */
export function compareTrialBalance(file: Acct[], books: Acct[], ranges: Record<string, number> = {}): { months: string[]; diffs: TbDiff[] } {
  // Odoo shows profit to date as an "undistributed profits" account, the books compute it: equity is compared in total.
  const EQUITY = "Equity: retained earnings and other equity (in total)";
  const isEquity = (a: Acct) => a.cls === "retained_earnings" || a.cls === "other_equity";
  const key = (a: Acct) => (isEquity(a) ? "=equity" : a.code ? `#${a.code}` : a.name.trim().toLowerCase());
  const label = (a: Acct) => (isEquity(a) ? EQUITY : [a.code, a.name].filter(Boolean).join(" "));
  const sum = (list: Acct[]) => {
    const m = new Map<string, { label: string; amounts: Record<string, number> }>();
    for (const a of list) {
      const e = m.get(key(a)) ?? { label: label(a), amounts: {} };
      for (const [p, v] of Object.entries(a.amounts)) e.amounts[p] = (e.amounts[p] ?? 0) + v;
      m.set(key(a), e);
    }
    return m;
  };
  const f = sum(file), b = sum(books);
  const stmt = (cls: string) => (isPL(cls as ClassKey) ? "PL" : "BS");
  const has = new Set(file.flatMap((a) => Object.entries(a.amounts).filter(([, v]) => Math.abs(v) > 0.004).map(([p]) => `${p}|${stmt(a.cls)}`)));
  const clsOf = new Map<string, string>();
  for (const a of [...books, ...file]) if (!clsOf.has(key(a))) clsOf.set(key(a), a.cls);
  const months = [...new Set([...f.values()].flatMap((a) => Object.keys(a.amounts)))].sort();
  const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
  const diffs: TbDiff[] = [];
  for (const p of months) for (const k of new Set([...f.keys(), ...b.keys()])) {
    if (!has.has(`${p}|${stmt(clsOf.get(k) ?? "")}`)) continue;
    const span = stmt(clsOf.get(k) ?? "") === "PL" ? Math.max(1, ranges[p] ?? 1) : 1;
    const x = r2(Array.from({ length: span }, (_, i) => b.get(k)?.amounts[addMonths(p, -i)] ?? 0).reduce((t, v) => t + v, 0)), y = r2(f.get(k)?.amounts[p] ?? 0);
    if (Math.abs(x - y) > 1) diffs.push({ period: p, account: (b.get(k) ?? f.get(k))!.label, books: x, file: y, diff: r2(x - y) });
  }
  return { months, diffs: diffs.sort((u, v) => u.period.localeCompare(v.period) || u.account.localeCompare(v.account)) };
}
