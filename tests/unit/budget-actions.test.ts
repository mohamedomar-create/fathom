import { describe, expect, it } from "vitest";
import { linesMatchRows, RowSchema, SaveRowsSchema, SetupSchema } from "@/lib/company/budget-schema";
import { emptySetup, setupDrift } from "@/lib/engine/budget-setup";

const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
const row = (over: Record<string, unknown> = {}) => ({ view: "revenue", key: "p:A", label: "A", mode: "year", basis: { kind: "amount", value: 1200 }, cost: null, months: Array(12).fill(100), ...over });
const setup = { products: ["A"], groups: [{ id: "g1", name: "G", products: ["A"], customers: [] }], streams: { rental: [] }, expenses: { merged: [], excluded: [] } };

describe("budget schemas", () => {
  it("accepts a valid setup and rows", () => {
    expect(SetupSchema.safeParse(setup).success).toBe(true);
    expect(RowSchema.safeParse(row()).success).toBe(true);
    expect(RowSchema.safeParse(row({ basis: { kind: "units", units: 3, price: 4 }, cost: { kind: "margin", pct: 20 }, cls: "cos_variable" })).success).toBe(true);
    expect(SaveRowsSchema.safeParse({ rows: [row()], views: ["revenue"], lines: [], setup }).success).toBe(true);
  });
  it("refuses months length other than 12", () => {
    expect(RowSchema.safeParse(row({ months: Array(11).fill(1) })).success).toBe(false);
  });
  it("refuses an unknown basis kind", () => {
    expect(RowSchema.safeParse(row({ basis: { kind: "weird", value: 1 } })).success).toBe(false);
  });
  it("refuses more than 20,000 rows", () => {
    expect(SaveRowsSchema.safeParse({ rows: Array(20001).fill(row()), views: ["revenue"], lines: null, setup: null }).success).toBe(false);
  });
  it("refuses empty or duplicate views", () => {
    expect(SaveRowsSchema.safeParse({ rows: [], views: [], lines: null, setup: null }).success).toBe(false);
    expect(SaveRowsSchema.safeParse({ rows: [], views: ["revenue", "revenue"], lines: null, setup: null }).success).toBe(false);
  });
});

describe("lines-match-rows", () => {
  const rows = [row(), row({ key: "p:B", months: Array(12).fill(50) })];
  const lines = (amt: number) => months.map((month) => ({ key: "cls:revenue", month, amount: amt }));
  it("is true when revenue lines equal the rows", () => {
    expect(linesMatchRows(rows, lines(150), months)).toBe(true);
    expect(linesMatchRows(rows, lines(150.005), months)).toBe(true);
  });
  it("is false when they differ", () => {
    expect(linesMatchRows(rows, lines(149), months)).toBe(false);
    expect(linesMatchRows(rows, [], months)).toBe(false);
  });
  it("skips the check without revenue rows", () => {
    expect(linesMatchRows([row({ view: "expense" })], [], months)).toBe(true);
  });
});

describe("setup-drift", () => {
  it("flags a version setup that differs from the current one", () => {
    expect(setupDrift(setup, emptySetup())).toBe(true);
    expect(setupDrift(setup, setup)).toBe(false);
    expect(setupDrift(null, emptySetup())).toBe(false);
  });
});
