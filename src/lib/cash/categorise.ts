import { normAr } from "@/lib/ingest/parse";
import { detectKind, kindsFor, type Kind } from "./kinds";

/** A category the cash book learned from a saved entry (0048), as Settings lists it: for a customer/supplier, or for a description. */
export interface CategoryRule {
  id: number; direction: "in" | "out"; matchOn: "party" | "note"; match: string; category: string; kind: Kind; uses: number; lastUsed: string;
}
export interface Suggestion { category: string; kind: Kind; from: "party" | "note" | "words" | "none" }

/** How names and descriptions are compared: as the database's private.cash_match (Arabic spelled one way, case, spaces). */
export const matchKey = (s: string) => normAr(s.replace(/[ؐ-ًؚ-ٰٟـ]/g, "")).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);

/** What the server found for an entry (0049 cash_suggest): the learned category, its kind, and whether it came from the name or the description. */
export interface LearnedRule { category: string; kind: Kind; from: "party" | "note" }
export interface SuggestInput { direction: "in" | "out"; party: string; note: string }

/**
 * The category and kind to offer: the learned rule the server found (the customer/supplier's own first, then the
 * longest learned description in this one), else the keyword rules for the kind alone.
 */
export function suggestFrom(rule: LearnedRule | null, e: SuggestInput): Suggestion {
  if (rule && rule.category && kindsFor(e.direction).includes(rule.kind)) return { category: rule.category, kind: rule.kind, from: rule.from };
  const kind = detectKind(e.direction, `${e.party} ${e.note}`);
  return { category: "", kind, from: kind === (e.direction === "in" ? "sale" : "expense") ? "none" : "words" };
}

/**
 * Asks the server for a learned rule while someone types: once, 300 ms after the typing stops, and only the newest
 * answer is kept (a late answer to an older question is dropped). Nothing typed, or a failed question, gives no rule.
 */
export function createSuggester(fetcher: (i: SuggestInput) => Promise<LearnedRule | null>, onResult: (r: LearnedRule | null) => void, delayMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let seq = 0;
  return {
    ask(i: SuggestInput) {
      const mine = ++seq;
      if (timer) clearTimeout(timer);
      if (!i.party.trim() && !i.note.trim()) { onResult(null); return; }
      timer = setTimeout(() => {
        fetcher(i).then((r) => { if (mine === seq) onResult(r); }, () => { if (mine === seq) onResult(null); });
      }, delayMs);
    },
    stop() { seq++; if (timer) clearTimeout(timer); },
  };
}

/**
 * What is saved: the person's own category and kind when they chose one (null: no choice made), else the suggestion.
 * A chosen category other than the suggested one never keeps the suggestion's kind: the kind is worked out again from
 * the category and the entry's words (a "Drawings" chip is drawings, not an expense; "Sales" for a customer whose rule
 * said owner's money is a sale).
 */
export function resolveEntry(s: Suggestion, choice: { category: string | null; kind: Kind | null },
  e: { direction: "in" | "out"; party: string; note: string }): { category: string; kind: Kind } {
  const category = choice.category === null ? s.category : choice.category.trim();
  if (choice.kind) return { category, kind: choice.kind };
  const same = matchKey(category) === matchKey(s.category);
  return { category, kind: same ? s.kind : detectKind(e.direction, `${category} ${e.party} ${e.note}`) };
}

/** The categories most used for a direction (ties: the most recent), spelled as last typed; a suggestion goes first. */
export function topCategories(entries: { day: string; direction: "in" | "out"; category: string }[], direction: "in" | "out", first = "", n = 6): string[] {
  const by = new Map<string, { name: string; uses: number; last: string }>();
  for (const e of entries) {
    const name = e.category.trim();
    if (e.direction !== direction || !name) continue;
    const k = matchKey(name);
    const g = by.get(k);
    if (!g) by.set(k, { name, uses: 1, last: e.day });
    else { g.uses++; if (e.day >= g.last) { g.last = e.day; g.name = name; } }
  }
  const ranked = [...by.entries()].sort((a, b) => b[1].uses - a[1].uses || b[1].last.localeCompare(a[1].last));
  const lead = first.trim() ? (by.get(matchKey(first))?.name ?? first.trim()) : "";
  const names = ranked.map(([, g]) => g.name).filter((x) => !lead || matchKey(x) !== matchKey(lead));
  return (lead ? [lead, ...names] : names).slice(0, n);
}
