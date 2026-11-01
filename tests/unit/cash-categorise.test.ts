// Phase 4c: the cash book suggests a category from what it learned (customer/supplier first, then words in the
// description), then from keywords; a person's own choice always wins.
import { describe, expect, it } from "vitest";
import { matchKey, resolveEntry, suggest, topCategories, type CategoryRule } from "@/lib/cash/categorise";

const rule = (r: Partial<CategoryRule> & Pick<CategoryRule, "matchOn" | "match" | "category">): CategoryRule =>
  ({ id: 1, direction: "in", kind: "sale", uses: 1, lastUsed: "2026-03-01T00:00:00Z", ...r });

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

describe("suggest", () => {
  const rules = [
    rule({ id: 1, matchOn: "party", match: "nile cafe", category: "Drinks" }),
    rule({ id: 2, matchOn: "note", match: "tea", category: "Snacks", uses: 9 }),
    rule({ id: 3, matchOn: "note", match: "electricity bill", category: "Utilities", direction: "out", kind: "expense" }),
    rule({ id: 4, matchOn: "note", match: "bill", category: "Other", direction: "out", kind: "expense", uses: 20 }),
    rule({ id: 5, matchOn: "party", match: "nile cafe", category: "Refunds", direction: "out", kind: "expense" }),
  ];
  it("the customer's own rule comes first, before words in the description", () => {
    expect(suggest(rules, { direction: "in", party: "Nile  CAFE", note: "tea" })).toEqual({ category: "Drinks", kind: "sale", from: "party" });
  });
  it("money out from the same name uses its own rule", () => {
    expect(suggest(rules, { direction: "out", party: "nile cafe", note: "" }).category).toBe("Refunds");
  });
  it("then a learned description found in the new one, as whole words, the longest first", () => {
    expect(suggest(rules, { direction: "in", party: "", note: "Tea for staff" })).toEqual({ category: "Snacks", kind: "sale", from: "note" });
    expect(suggest(rules, { direction: "out", party: "", note: "March electricity bill" })).toEqual({ category: "Utilities", kind: "expense", from: "note" });
    expect(suggest(rules, { direction: "in", party: "", note: "steak" }).from).not.toBe("note");
  });
  it("then the keyword rules for the kind, with no category", () => {
    expect(suggest(rules, { direction: "out", party: "", note: "fridge" })).toEqual({ category: "", kind: "asset", from: "words" });
    expect(suggest([], { direction: "in", party: "", note: "loan from bank" })).toEqual({ category: "", kind: "loan", from: "words" });
  });
  it("nothing known: a plain sale or expense", () => {
    expect(suggest([], { direction: "out", party: "", note: "" })).toEqual({ category: "", kind: "expense", from: "none" });
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
