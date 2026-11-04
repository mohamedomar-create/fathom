// The AI system doctor's findings: every check and flag the system already makes, as one list ranked by how much money
// is at stake, with a health score. Worked out by rules from each company's own books (no AI, no cost).
import { describe, expect, it } from "vitest";
import { doctorFindings, healthScore } from "@/lib/doctor/findings";
import type { Check } from "@/lib/company/checks";
import type { MonthData } from "@/lib/engine";
import type { ExpenseFlag } from "@/lib/engine/expenses";

const months: MonthData[] = ["2026-01", "2026-02", "2026-03"].map((period) => ({ period, pl: { revenue: 304_000, cos_variable: 182_400 }, bs: { cash: 1_000_000 } }));
const base = "/company/x";
const check = (c: Partial<Check>): Check => ({ id: "review", severity: "warn", title: "t", detail: "d", ...c });

describe("doctor findings", () => {
  const checks: Check[] = [
    check({ id: "bs_balance", severity: "block", period: "2026-03", statement: "BS", title: "Balance sheet doesn't balance", diff: 12_500 }),
    check({ title: 'Balance left in "Suspense"', period: "2026-03", statement: "BS", actual: -40_000 }),
    check({ title: "Customer days of 90 look too high", period: "2026-03", actual: 90 }),
    check({ title: "Gross margin 20% against a usual 40%", period: "2026-02", statement: "PL", actual: 0.2, expected: 0.4 }),
    check({ id: "partial_month", severity: "info", title: "Part month" }),
  ];
  const flags: ExpenseFlag[] = [{ k: "double", d: "2026-02-03", p: "2026-02", doc: "BILL/1", s: "Acme", t: "Rent", a: 25_000, d2: "2026-02-04", doc2: "BILL/2" }];
  const f = doctorFindings({ checks, expenseFlags: flags, months, basePath: base });

  it("puts a money figure on each finding, with what it means", () => {
    const by = (t: string) => f.find((x) => x.title.startsWith(t))!;
    expect(by("Balance sheet")).toMatchObject({ area: "books", severity: "high", impact: 12_500, basis: "difference" });
    expect(by("Balance left")).toMatchObject({ impact: 40_000, basis: "unexplained" });
    // 90 days against a normal 60: 30 days of sales (304,000 a month) tied up.
    expect(by("Customer days")).toMatchObject({ area: "payments", basis: "cash tied up", impact: Math.round((30 * 304_000 * 12) / 365) });
    // 20 points of margin on that month's revenue.
    expect(by("Gross margin")).toMatchObject({ basis: "margin at risk", impact: Math.round(0.2 * 304_000) });
    expect(by("Possible double payment")).toMatchObject({ area: "expenses", basis: "possible double payment", impact: 25_000 });
  });

  it("leaves out information-only checks", () => {
    expect(f.some((x) => x.title === "Part month")).toBe(false);
  });

  it("ranks by money at stake, largest first, and links each finding to where it can be fixed", () => {
    expect(f.map((x) => x.impact)).toEqual([...f.map((x) => x.impact)].sort((a, b) => (b ?? -1) - (a ?? -1)));
    expect(f[0].title).toMatch(/Customer days/);
    for (const x of f) expect(x.href.startsWith(base)).toBe(true);
  });

  it("gives every finding a stable key, the same on every load", () => {
    const again = doctorFindings({ checks, expenseFlags: flags, months, basePath: base });
    expect(again.map((x) => x.key)).toEqual(f.map((x) => x.key));
    expect(new Set(f.map((x) => x.key)).size).toBe(f.length);
  });

  it("an accepted finding goes to the end, keeps its reason, and no longer counts against the score", () => {
    const top = f[0];
    const g = doctorFindings({ checks, expenseFlags: flags, months, basePath: base, decisions: [{ key: top.key, reason: "Known: a government customer", at: "2026-11-04T10:00:00Z", by: "Owner" }] });
    expect(g.at(-1)).toMatchObject({ key: top.key, accepted: { reason: "Known: a government customer" } });
    expect(healthScore(g, months).score).toBeGreaterThan(healthScore(f, months).score);
  });

  it("scores 100 for clean books and less the more is wrong and the more money it touches", () => {
    expect(healthScore([], months).score).toBe(100);
    const s = healthScore(f, months);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThan(80);
    expect(s.open).toBe(f.length);
  });
});
