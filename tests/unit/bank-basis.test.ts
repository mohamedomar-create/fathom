// The Banking page on one basis (fix plan 3.4, register D25/D26): the last twelve months as recorded when only the part
// month is short, never scaled by 12 ÷ 11.5; tax at the profile rate when the books carry none.
import { describe, expect, it } from "vitest";
import { addMonths, bankAssessment, twelveMonths, type MonthData } from "@/lib/engine";

const month = (period: string, scale = 1): MonthData => ({
  period,
  pl: { revenue: 100_000 * scale, cos_variable: 60_000 * scale, exp_fixed: 20_000 * scale },
  bs: { cash: 500_000, ar: 150_000, inventory: 200_000, ap: 100_000, ltd: 300_000, other_equity: 500_000, retained_earnings: 250_000 },
});
const ms = [...Array.from({ length: 24 }, (_, i) => month(addMonths("2024-10", i))), month("2026-10", 0.5)];

describe("the Banking basis", () => {
  it("12 months to 15 Oct are a true year: the rest of Oct 2025 is added at its share of days, never 11.5 months scaled up", () => {
    const b = twelveMonths(ms, "2026-10", 1, "2026-10-15");
    expect(b.factor).toBe(1);
    expect(Math.round(b.Pa.revenue)).toBe(1_150_000 + Math.round(100_000 * 16 / 31));
    expect(b.label).toBe("12 months to 15 Oct 2026");
  });

  it("the year before is taken on the same days, so a flat business shows no growth", () => {
    const flat = [...Array.from({ length: 36 }, (_, i) => month(addMonths("2023-10", i))).filter((m) => m.period < "2026-10"), month("2026-10", 15 / 31)];
    const b = twelveMonths(flat, "2026-10", 1, "2026-10-15");
    expect(Math.round(b.Pa.revenue)).toBe(Math.round(b.prior!.P.revenue));
  });

  it("a gap of whole months is still scaled up to a year", () => {
    const b = twelveMonths(ms.filter((m) => m.period >= "2026-05"), "2026-10", 1);
    expect(b.factor).toBe(2);
  });

  it("no tax booked: the cash for debt deducts tax at the profile rate on the profit before tax", () => {
    const b = twelveMonths(ms, "2026-09", 1);
    const a = bankAssessment(b, { taxRate: 0.225 });
    // EBITDA 240,000 a year; profit before tax 240,000; tax 54,000.
    expect(a.capacity.cashForDebt).toBe(186_000);
  });
});

describe("an operating loss is not 'barely covering' interest (register D30)", () => {
  const loss = (p: string): MonthData => ({ period: p, pl: { revenue: 100_000, cos_variable: 90_000, exp_fixed: 30_000, interest_expenses: 1_000 }, bs: month(p).bs });
  it("the bank page and the analyst notes say profit does not cover interest at all", async () => {
    const { analyze } = await import("@/lib/engine");
    const ls = Array.from({ length: 12 }, (_, i) => loss(addMonths("2025-10", i)));
    const a = bankAssessment(twelveMonths(ls, "2026-09", 1), {});
    expect(a.ratios.find((m) => m.key === "int_cover")!.banker).toMatch(/operating loss: nothing is left to pay the interest/i);
    const n = analyze(ls, { type: "month", end: "2026-09" }, { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 });
    expect(n.findings.find((f) => /Interest cover/.test(f.title))!.text).toBe("Operating loss: profit does not cover the interest at all.");
  });
});

describe("the stress test uses the same tax as the headline (review)", () => {
  it("'As reported' DSCR equals the headline DSCR when the books carry no tax", async () => {
    const { bankPack } = await import("@/lib/engine");
    const p = bankPack(ms, "2026-09", { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 }, {}, "Co");
    const head = p.assessment.ratios.find((r) => r.key === "dscr")!.value;
    expect(p.stress.scenarios[0].dscr).toBeCloseTo(head!, 6);
  });
});

describe("no raw decimals in text (register D26)", () => {
  it("nothing the bank page or the analyst notes write holds a number with four or more decimals", async () => {
    const { analyze, bankPack } = await import("@/lib/engine");
    const short = ms.filter((m) => m.period >= "2026-02");
    const texts: string[] = [];
    const p = bankPack(short, "2026-10", { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 }, {}, "Co", undefined, "en", "2026-10-15");
    texts.push(p.basis.label, p.memo, ...p.assessment.flags.flatMap((f) => [f.title, f.detail, f.advice]), ...p.assessment.ratios.flatMap((r) => [r.banker, r.advice]));
    const a = analyze(short, { type: "month", end: "2026-10" }, { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 }, { asOf: "2026-10-15" });
    texts.push(a.view.window.label, a.view.prior?.label ?? "", ...a.findings.flatMap((f) => [f.title, f.text]));
    expect(texts.filter((t) => /\d\.\d{4,}/.test(t))).toEqual([]);
  });
});
