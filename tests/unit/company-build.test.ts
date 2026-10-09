import { describe, expect, it } from "vitest";
import sample from "../../reference/sample.json";
import { analyze, type MonthData } from "@/lib/engine";
import { buildMonths, naturalAccounts, toNatural, toRaw } from "@/lib/company/build";
import { spreadAccounts } from "@/lib/company/demo";

describe("account storage round-trip", () => {
  it("raw ↔ natural sign conversion is symmetric and class-aware", () => {
    expect(toRaw("revenue", 1000)).toBe(-1000); // credit-normal
    expect(toRaw("cash", 500)).toBe(500); // debit-normal
    expect(toNatural("ap", -300)).toBe(300);
    expect(toNatural("fixed_assets", -50)).toBe(-50); // accumulated depreciation stays negative
  });

  it("demo accounts → raw storage → natural → months reproduces sample.json exactly", () => {
    const months = sample.months as MonthData[];
    const accounts = spreadAccounts(months);
    const stored = accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, cls: a.cls, raw: Object.fromEntries(Object.entries(a.amounts).map(([p, v]) => [p, toRaw(a.cls, v)])) }));
    const rebuilt = buildMonths(naturalAccounts(stored));
    expect(rebuilt.map((m) => m.period)).toEqual(months.map((m) => m.period));
    for (const m of months) {
      const r = rebuilt.find((x) => x.period === m.period)!;
      for (const [k, v] of Object.entries(m.pl)) expect(r.pl[k as keyof typeof r.pl] ?? 0, `${m.period} ${k}`).toBe(v);
      for (const [k, v] of Object.entries(m.bs)) expect(r.bs[k as keyof typeof r.bs] ?? 0, `${m.period} ${k}`).toBe(v);
    }
    const a = analyze(rebuilt, { type: "month", end: "2026-09" }, { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 });
    expect(Math.abs(a.view.B.imbalance)).toBeLessThan(0.5);
  });

  it("fills gaps so the month list is continuous", () => {
    const m = buildMonths([{ id: "1", code: "", name: "Sales", cls: "revenue", amounts: { "2026-01": 10, "2026-04": 20 } }]);
    expect(m.map((x) => x.period)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });
});
