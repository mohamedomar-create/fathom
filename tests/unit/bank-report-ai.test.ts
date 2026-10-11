import { describe, expect, it } from "vitest";
import { analyze, type MonthData } from "@/lib/engine";
import { buildContext } from "@/lib/ai/context";
import { COMMENTARY_SECTIONS } from "@/lib/ai/sections";
import { AssumptionsSchema } from "@/lib/company/assumptions-schema";
import { normaliseSections } from "@/lib/report/types";
import sample from "../../reference/sample.json";

const months = sample.months as MonthData[];
const settings = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 };

describe("report sections", () => {
  it("adds the bank and real-profit pages to existing reports, switched off", () => {
    const s = normaliseSections([{ key: "summary", enabled: true }]);
    for (const k of ["bank", "bank_outlook", "realprofit"]) expect(s.find((x) => x.key === k)?.enabled).toBe(false);
  });
});

describe("AI context", () => {
  const a = analyze(months, { type: "month", end: "2026-09" }, settings);
  const as = { inflation: 20, fxStart: 49, fxEnd: 48.5, importShare: 40, rate: 24, requestAmount: 2000000, requestType: "term_loan" as const, requestPurpose: "a new warehouse" };
  it("sends the bank and real-profit blocks only when those sections are written", () => {
    expect(COMMENTARY_SECTIONS).toContain("bank");
    const ctx = buildContext(a, months, { name: "Demo", currency: "EGP", assumptions: as }, ["bank"]) as Record<string, unknown>;
    expect(ctx.bank).toBeTruthy();
    expect(ctx.real_profit).toBeUndefined();
    const json = JSON.stringify(ctx.bank);
    expect(json).not.toMatch(/NaN|undefined/);
    expect(json).toMatch(/a new warehouse/);
    expect(json).toMatch(/Debt service cover/);
    const kpiOnly = buildContext(a, months, { name: "Demo", currency: "EGP" }, ["kpis"]) as Record<string, unknown>;
    expect(kpiOnly.bank).toBeUndefined();
    const rp = buildContext(a, months, { name: "Demo", currency: "EGP", assumptions: as }, ["realprofit"]) as Record<string, unknown>;
    expect(JSON.stringify(rp.real_profit)).toMatch(/real_profit|Customers paying later/);
  });
});

describe("assumptions schema", () => {
  it("accepts a loan request and rejects bad values", () => {
    expect(AssumptionsSchema.safeParse({ requestAmount: 2000000, requestType: "working_capital", requestPurpose: "stock for Ramadan" }).success).toBe(true);
    expect(AssumptionsSchema.safeParse({ requestType: "mortgage" }).success).toBe(false);
    expect(AssumptionsSchema.safeParse({ requestPurpose: "x".repeat(301) }).success).toBe(false);
    expect(AssumptionsSchema.safeParse({ requestAmount: -5 }).success).toBe(false);
    expect(AssumptionsSchema.safeParse({ somethingElse: 1 }).success).toBe(false);
  });
});
