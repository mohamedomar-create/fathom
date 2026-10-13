import { describe, expect, it } from "vitest";
import { analyze, cashFlowByMonth, forecast, periodView, selectableEnds, type MonthData } from "@/lib/engine";
import { buildMonths } from "@/lib/company/build";
import type { AccountLine } from "@/lib/company/types";

const S = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 };

/** A small company built through buildMonths (as stored data is), so gaps and missing statements are real. */
function books(opts: { months: string[]; plOnly?: string[]; bsOnly?: string[] }): MonthData[] {
  const rev: Record<string, number> = {}, cos: Record<string, number> = {}, cash: Record<string, number> = {}, eq: Record<string, number> = {};
  let c = 1000, e = 1000;
  for (const p of opts.months) {
    const pl = !opts.bsOnly?.includes(p), bs = !opts.plOnly?.includes(p);
    if (pl) { rev[p] = 100; cos[p] = 60; c += 40; e += 40; }
    if (bs) { cash[p] = c; eq[p] = e; }
  }
  const accts: AccountLine[] = [
    { id: "1", code: "4000", name: "Sales", cls: "revenue", amounts: rev },
    { id: "2", code: "5000", name: "Cost", cls: "cos_variable", amounts: cos },
    { id: "3", code: "1000", name: "Bank", cls: "cash", amounts: cash },
    { id: "4", code: "3000", name: "Equity", cls: "retained_earnings", amounts: eq },
  ];
  return buildMonths(accts);
}

describe("months that were not loaded are never read as zero", () => {
  it("a gap inside the data leaves the quarter incomplete and names the missing month", () => {
    const m = books({ months: ["2026-01", "2026-03"] });
    expect(m.map((x) => x.period)).toEqual(["2026-01", "2026-03"]);
    const v = periodView(m, { type: "quarter", end: "2026-03" }, 1);
    expect(v.complete).toBe(false);
    expect(v.missing.pl).toEqual(["2026-02"]);
    // March's cash flow would need February's balance sheet, which is not loaded.
    const a = analyze(m, { type: "month", end: "2026-03" }, S);
    expect(a.W).toBeNull();
    expect(a.view.missing.openingBS).toBe(true);
  });

  it("a P&L-only month keeps the last balance sheet for balances and has no cash flow", () => {
    const m = books({ months: ["2026-01", "2026-02", "2026-03"], plOnly: ["2026-03"] });
    const a = analyze(m, { type: "month", end: "2026-03" }, S);
    expect(a.view.bsAt).toBe("2026-02");
    expect(a.view.missing.endBS).toBe(true);
    expect(a.view.B.cash).toBe(1080);
    expect(a.W).toBeNull();
    expect(a.CF).toBeNull();
    expect(a.view.P.revenue).toBe(100);
  });

  it("an opening balance month (balance sheet only) gives the first month a cash flow and is not a selectable period", () => {
    const m = books({ months: ["2025-12", "2026-01", "2026-02"], bsOnly: ["2025-12"] });
    expect(selectableEnds(m, "month", 1).map((e) => e.end)).toEqual(["2026-01", "2026-02"]);
    const a = analyze(m, { type: "month", end: "2026-01" }, S);
    expect(a.CF!.dcash).toBe(40);
    expect(a.CF!.cfo + a.CF!.cfi + a.CF!.cff + a.CF!.unreconciled).toBeCloseTo(40, 9);
    const q = analyze(m, { type: "quarter", end: "2026-02" }, S);
    expect(q.CF!.dcash).toBe(80);
  });

  it("monthly cash flows skip months without both balance sheets and add up to the period", () => {
    const m = books({ months: ["2025-12", "2026-01", "2026-02", "2026-03"], bsOnly: ["2025-12"], plOnly: ["2026-02"] });
    const r = cashFlowByMonth(m, ["2026-01", "2026-02", "2026-03"]);
    expect(r.rows.map((x) => x.period)).toEqual(["2026-01"]);
    expect(r.skipped).toEqual(["2026-02", "2026-03"]);
  });

  it("audited annual columns are read as years, with the prior year end as the opening balance", () => {
    const m = books({ months: ["2024-12", "2025-12"] });
    const a = analyze(m, { type: "month", end: "2025-12" }, S);
    expect(a.view.annual).toBe(true);
    expect(a.view.window.periods).toHaveLength(12);
    expect(a.view.complete).toBe(true);
    expect(a.view.days).toBe(365);
    expect(a.CF!.dcash).toBe(40);
    // A monthly forecast is refused with the exact export to upload.
    const f = forecast(m, S);
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.reason).toMatch(/annual.*General Ledger/);
  });

  it("a part month counts only the days covered and says so in the label", () => {
    const m = books({ months: ["2026-01", "2026-02", "2026-03"] });
    const a = analyze(m, { type: "month", end: "2026-03" }, S, { asOf: "2026-03-10" });
    expect(a.view.days).toBe(10);
    expect(a.view.window.label).toBe("Mar 2026 (to 10 Mar)");
    const q = analyze(m, { type: "quarter", end: "2026-03" }, S, { asOf: "2026-03-10" });
    expect(q.view.days).toBe(31 + 28 + 10);
  });
});
