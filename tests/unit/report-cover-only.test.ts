import { describe, expect, it } from "vitest";
import { analyze } from "@/lib/engine";
import { reportMonths } from "@/lib/report/types";

const settings = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 };

describe("a shared report that shows only its cover", () => {
  it("gets one empty month for its period, so the cover can be labelled without any figures", () => {
    const months = reportMonths([], "2026-09");
    expect(months).toEqual([{ period: "2026-09", pl: {}, bs: {}, has: { pl: false, bs: false } }]);
    const a = analyze(months, { type: "month", end: "2026-09" }, settings);
    expect(a.view.window.label).toMatch(/2026/);
  });
  it("keeps the months it was given", () => {
    const m = [{ period: "2026-08", pl: { revenue: 1 }, bs: {} }];
    expect(reportMonths(m, "2026-09")).toBe(m);
  });
});
