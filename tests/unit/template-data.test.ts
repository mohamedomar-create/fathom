import { describe, expect, it } from "vitest";
import { bsCalc, plCalc } from "@/lib/engine";
import { buildMonths } from "@/lib/company/build";
import { ingest, type IngestOptions, type IngestResult } from "@/lib/ingest/pipeline";
import { readWorkbook } from "@/lib/ingest/read";
import { buildTemplate } from "@/lib/templates/build";
import { storedFill } from "@/lib/templates/fill";
import { monthsBetween } from "@/lib/templates/spec";
import type { AccountLine } from "@/lib/company/types";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-12" };
const acc = (id: string, code: string, name: string, cls: AccountLine["cls"], amounts: Record<string, number>): AccountLine => ({ id, code, name, cls, amounts });
// Fourteen months across two years: the template is not cut to one financial year.
const MONTHS = ["2024-11", "2024-12", ...Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`)];
const per = (v: number) => Object.fromEntries(MONTHS.map((p, i) => [p, v + i]));
const STORED: AccountLine[] = [
  acc("1", "410000", "Revenues", "revenue", per(1000)),
  acc("2", "510000", "Cost of sales", "cos_variable", per(400)),
  acc("3", "620100", "Rent", "exp_fixed", per(100)),
  acc("4", "121000", "Bank", "cash", Object.fromEntries(MONTHS.map((p, i) => [p, 5000 + (500 + 3 * i) * (i + 1) - 0]))),
  acc("5", "", "Owner's capital", "other_equity", Object.fromEntries(MONTHS.map((p) => [p, 5000]))),
];
// The balance sheet balances: earnings to date as its own line, as iReport stores it.
STORED.push(acc("6", "", "Earnings to date (computed from P&L accounts)", "retained_earnings", Object.fromEntries(MONTHS.map((p) => [p, STORED[3].amounts[p] - 5000]))));

describe("D2: the financials template filled with the company's own data", () => {
  it("carries every stored month (not one year), codes and classes, P&L and balance sheet apart", () => {
    const f = storedFill(STORED, []);
    expect(f.pl!.months).toEqual(MONTHS);
    expect(f.bs!.months).toEqual(MONTHS);
    expect(f.pl!.rows.map((r) => [r.code, r.cls])).toEqual([["410000", "revenue"], ["510000", "cos_variable"], ["620100", "exp_fixed"]]);
    expect(f.bs!.rows.find((r) => r.code === "121000")?.values["2025-12"]).toBe(STORED[3].amounts["2025-12"]);
  });
  it("adds the accounts the company has classed but holds no balances for, and never one left out", () => {
    const f = storedFill(STORED, [
      { key: "#530000", cls: "exp_variable", name: "Commissions" },
      { key: "#410000", cls: "revenue", name: "Revenues" },
      { key: "Petty cash", cls: "cash", name: "Petty cash" },
      { key: "#999", cls: "", name: "Suspense" },
    ]);
    expect(f.pl!.rows.filter((r) => r.code === "530000")).toEqual([{ code: "530000", name: "Commissions", cls: "exp_variable", values: {} }]);
    expect(f.pl!.rows.filter((r) => r.code === "410000")).toHaveLength(1);
    expect(f.bs!.rows.find((r) => r.name === "Petty cash")).toEqual({ code: "", name: "Petty cash", cls: "cash", values: {} });
    expect([...f.pl!.rows, ...f.bs!.rows].some((r) => r.code === "999")).toBe(false);
  });
  it("reads back to the same figures, month by month", async () => {
    const buf = await buildTemplate("financials", { year: 2024, fyStart: 1, currency: "EGP", fill: storedFill(STORED, []) });
    const again = ingest(await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "data.xlsx"), OPTS);
    expect(again.layouts.flatMap((l) => l.cellErrors ?? [])).toEqual([]);
    const totals = (ms: ReturnType<typeof buildMonths>) => Object.fromEntries(ms.map((m) => [m.period, { rev: plCalc(m.pl).revenue, ni: plCalc(m.pl).net_income, ta: bsCalc(m.bs).ta }]));
    const fromFile = (r: IngestResult) => buildMonths(r.lines.filter((l) => l.cls && !l.excluded).map((l) => ({ id: l.key, code: l.code, name: l.name, cls: l.cls!, amounts: l.values })));
    expect(totals(fromFile(again))).toEqual(totals(buildMonths(STORED)));
  });
});

describe("D2: the blank template for any run of months", () => {
  it("lists every month from the first to the last", () => {
    expect(monthsBetween("2024-11", "2025-02")).toEqual(["2024-11", "2024-12", "2025-01", "2025-02"]);
  });
  it("refuses a reversed or very long run", () => {
    expect(monthsBetween("2025-02", "2024-11")).toEqual([]);
    expect(monthsBetween("2000-01", "2030-12")).toHaveLength(240);
  });
});
