// Phase 4c: the cash book suggests a category from what it learned (customer/supplier first, then words in the
// description), then from keywords; a person's own choice always wins.
import { describe, expect, it, vi } from "vitest";
import { createSuggester, matchKey, resolveEntry, suggestFrom, topCategories } from "@/lib/cash/categorise";

describe("matchKey", () => {
  it("tidies names the way the database does: case, spaces and Arabic spellings", () => {
    expect(matchKey("  NILE   Cafe ")).toBe("nile cafe");
    expect(matchKey("مؤسسة الأمل")).toBe(matchKey("موسسه الامل"));
  });
  it("spells Arabic exactly as the database's cash_match does (the same samples are checked in SQL)", () => {
    expect(matchKey("شركة النور")).toBe("شركه النور");
    expect(matchKey("مؤسسة")).toBe("موسسه");
    expect(matchKey("الأصول الثابتـة")).toBe("الاصول الثابته");
    expect(matchKey("شيئ إى آک ی")).toBe("شيي اي اك ي");
  });
});

describe("suggestFrom", () => {
  it("a learned rule from the server comes first, with where it came from", () => {
    expect(suggestFrom({ category: "Drinks", kind: "sale", from: "party" }, { direction: "in", party: "Nile Cafe", note: "fridge" }))
      .toEqual({ category: "Drinks", kind: "sale", from: "party" });
    expect(suggestFrom({ category: "Utilities", kind: "expense", from: "note" }, { direction: "out", party: "", note: "electricity bill" }).from).toBe("note");
  });
  it("a rule whose kind does not fit the direction is not used", () => {
    expect(suggestFrom({ category: "Drinks", kind: "sale", from: "party" }, { direction: "out", party: "Nile Cafe", note: "" }).category).toBe("");
  });
  it("then the keyword rules for the kind, with no category", () => {
    expect(suggestFrom(null, { direction: "out", party: "", note: "fridge" })).toEqual({ category: "", kind: "asset", from: "words" });
    expect(suggestFrom(null, { direction: "in", party: "", note: "loan from bank" })).toEqual({ category: "", kind: "loan", from: "words" });
  });
  it("nothing known: a plain sale or expense", () => {
    expect(suggestFrom(null, { direction: "out", party: "", note: "" })).toEqual({ category: "", kind: "expense", from: "none" });
  });
});

describe("createSuggester (asking the server while someone types)", () => {
  const input = (party: string) => ({ direction: "in" as const, party, note: "" });
  it("asks once, 300 ms after typing stops, with only the latest words", async () => {
    vi.useFakeTimers();
    const asked: string[] = [];
    const got: (string | null)[] = [];
    const s = createSuggester(async (i) => { asked.push(i.party); return { category: i.party.toUpperCase(), kind: "sale", from: "party" }; }, (r) => got.push(r?.category ?? null));
    s.ask(input("n")); s.ask(input("ni")); s.ask(input("nile"));
    await vi.advanceTimersByTimeAsync(299);
    expect(asked).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toEqual(["nile"]);
    expect(got).toEqual(["NILE"]);
    vi.useRealTimers();
  });
  it("a late answer to an older question never replaces the newer one", async () => {
    vi.useFakeTimers();
    const got: (string | null)[] = [];
    const slow: Record<string, number> = { old: 1000, new: 10 };
    const s = createSuggester((i) => new Promise((ok) => setTimeout(() => ok({ category: i.party, kind: "sale", from: "party" }), slow[i.party])), (r) => got.push(r?.category ?? null));
    s.ask(input("old"));
    await vi.advanceTimersByTimeAsync(300);
    s.ask(input("new"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(got).toEqual(["new"]);
    vi.useRealTimers();
  });
  it("nothing typed: no question, no rule", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    const got: unknown[] = [];
    const s = createSuggester(fetcher, (r) => got.push(r));
    s.ask(input("  "));
    await vi.advanceTimersByTimeAsync(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect(got).toEqual([null]);
    vi.useRealTimers();
  });
  it("a failed question leaves no rule rather than an error", async () => {
    vi.useFakeTimers();
    const got: unknown[] = [];
    const s = createSuggester(async () => { throw new Error("offline"); }, (r) => got.push(r));
    s.ask(input("nile"));
    await vi.advanceTimersByTimeAsync(300);
    expect(got).toEqual([null]);
    vi.useRealTimers();
  });
});

describe("resolveEntry", () => {
  const s = { category: "Drinks", kind: "sale" as const, from: "party" as const };
  const ctx = { direction: "in" as const, party: "Nile Cafe", note: "" };
  it("a person's choice wins over the suggestion", () => {
    expect(resolveEntry(s, { category: "Coffee", kind: "collection" }, ctx)).toEqual({ category: "Coffee", kind: "collection" });
  });
  it("with no choice, the suggestion is used", () => {
    expect(resolveEntry(s, { category: null, kind: null }, ctx)).toEqual({ category: "Drinks", kind: "sale" });
  });
  it("choosing no category is a choice too", () => {
    expect(resolveEntry(s, { category: "", kind: null }, ctx)).toEqual({ category: "", kind: "sale" });
  });
  it("another category than the rule's: the kind is worked out again, never the rule's kind", () => {
    const owner = { category: "Owner money", kind: "capital" as const, from: "party" as const };
    expect(resolveEntry(owner, { category: "Sales", kind: null }, { direction: "in", party: "Ahmed", note: "" })).toEqual({ category: "Sales", kind: "sale" });
  });
  it("the chosen category's own words decide the kind", () => {
    const none = { category: "", kind: "expense" as const, from: "none" as const };
    expect(resolveEntry(none, { category: "Drawings", kind: null }, { direction: "out", party: "", note: "" }).kind).toBe("drawings");
    expect(resolveEntry(none, { category: "مسحوبات", kind: null }, { direction: "out", party: "", note: "" }).kind).toBe("drawings");
    expect(resolveEntry(none, { category: "Purchases", kind: null }, { direction: "out", party: "", note: "" }).kind).toBe("purchase");
  });
  it("the rule's own category, picked as a chip, keeps the rule's kind", () => {
    const owner = { category: "Owner money", kind: "capital" as const, from: "party" as const };
    expect(resolveEntry(owner, { category: "owner money", kind: null }, { direction: "in", party: "Ahmed", note: "" }).kind).toBe("capital");
  });
});

describe("topCategories", () => {
  const e = (day: string, direction: "in" | "out", category: string) => ({ day, direction, category });
  const entries = [
    e("2026-03-01", "in", "Drinks"), e("2026-03-02", "in", "drinks"), e("2026-03-03", "in", "Snacks"), e("2026-03-04", "in", "Snacks"),
    e("2026-03-05", "in", "Cards"), e("2026-03-06", "out", "Rent"), e("2026-03-07", "in", ""), e("2026-03-08", "in", "A"), e("2026-03-09", "in", "B"),
    e("2026-03-10", "in", "C"), e("2026-03-11", "in", "D"),
  ];
  it("the six most used for that direction, ties to the most recent; names grouped ignoring case", () => {
    expect(topCategories(entries, "in")).toEqual(["Snacks", "drinks", "D", "C", "B", "A"]);
    expect(topCategories(entries, "out")).toEqual(["Rent"]);
  });
  it("the suggestion first, once", () => {
    expect(topCategories(entries, "in", "Cards")).toEqual(["Cards", "Snacks", "drinks", "D", "C", "B"]);
    expect(topCategories(entries, "in", "snacks")).toEqual(["Snacks", "drinks", "D", "C", "B", "A"]);
  });
});

describe("moneyExact (the quick entry's confirmation)", () => {
  it("shows what was typed: whole amounts without decimals, others to the piaster, never rounded to the pound", async () => {
    const { moneyExact } = await import("@/lib/engine/format");
    expect(moneyExact(12.5, "EGP")).toBe("EGP 12.50");
    expect(moneyExact(1250, "EGP")).toBe("EGP 1,250");
    expect(moneyExact(-3.456, "EGP")).toBe("-EGP 3.46");
  });
});
