import { describe, expect, it } from "vitest";
import { buildMonths } from "@/lib/company/build";
import { runChecks } from "@/lib/company/checks";
import { demoCompany } from "@/lib/company/demo";
import { demoSales } from "@/lib/company/demo-sales";
import { bankingReadiness, expensesReadiness, financialsReadiness, forecastReadiness, readiness, salesReadiness } from "@/lib/company/readiness";
import { demoExpenses } from "@/lib/company/demo-expenses";
import type { AccountLine } from "@/lib/company/types";

function company(months: string[], o: { bsOnly?: string[]; skipBS?: string[] } = {}) {
  const rev: Record<string, number> = {}, cash: Record<string, number> = {}, re: Record<string, number> = {};
  let c = 1000;
  for (const p of months) {
    if (!o.bsOnly?.includes(p)) { rev[p] = 100; c += 100; }
    if (!o.skipBS?.includes(p)) { cash[p] = c; re[p] = c; }
  }
  const accounts: AccountLine[] = [
    { id: "1", code: "4000", name: "Sales", cls: "revenue", amounts: rev },
    { id: "2", code: "1000", name: "Bank", cls: "cash", amounts: cash },
    { id: "3", code: "3000", name: "Retained", cls: "retained_earnings", amounts: re },
  ];
  const ms = buildMonths(accounts);
  return { months: ms, checks: runChecks({ accounts, months: ms }), fyStart: 1, today: "2026-12-10" };
}
const ps = (from: string, n: number) => Array.from({ length: n }, (_, i) => { const [y, m] = from.split("-").map(Number); const k = y * 12 + m - 1 + i; return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`; });

describe("data readiness", () => {
  it("a full year from a General Ledger, opening balance included, is complete and accurate", () => {
    const r = financialsReadiness(company(ps("2025-12", 13), { bsOnly: ["2025-12"] }));
    expect(r.completion).toBe(100);
    expect(r.accuracy).toBe(100);
    expect(r.items.every((i) => i.status === "done")).toBe(true);
  });

  it("names what is missing: months, the opening balance and a gap, each with what to upload", () => {
    const months = ps("2026-04", 9).filter((p) => p !== "2026-08");
    const r = financialsReadiness(company(months));
    const it = (id: string) => r.items.find((i) => i.id === id)!;
    expect(it("pl").completion).toBe(Math.round((8 / 12) * 100));
    expect(it("opening").status).toBe("missing");
    expect(it("opening").fix?.what).toContain("Apr 2026");
    expect(it("gaps").detail).toContain("1 month is missing");
    expect(it("pl").fix?.template).toBe("financials");
    expect(r.completion).toBeLessThan(100);
  });

  it("balance sheets missing for some months lower completion, and are named", () => {
    const r = financialsReadiness(company(ps("2026-01", 12), { skipBS: ["2026-05", "2026-06"] }));
    const bs = r.items.find((i) => i.id === "bs")!;
    expect(bs.completion).toBe(83);
    expect(bs.detail).toContain("10 of 12");
  });

  it("annual statements count as a year of P&L but say monthly figures are needed", () => {
    const r = financialsReadiness(company(["2024-12", "2025-12"]));
    expect(r.items.find((i) => i.id === "pl")!.detail).toContain("annual figures");
  });

  it("the demo company: sales tie to revenue, quantities and costs present", () => {
    const d = demoCompany();
    const s = salesReadiness({ months: d.months, checks: [], fyStart: 1, sales: demoSales() });
    expect(s.items.find((i) => i.id === "reconciled")!.accuracy).toBe(100);
    expect(s.items.find((i) => i.id === "customers")!.completion).toBe(100);
    expect(s.completion).toBeGreaterThanOrEqual(90);
  });

  it("no sales: the one step to take is shown, with the template", () => {
    const s = salesReadiness({ ...company(ps("2026-01", 3)), sales: null });
    expect(s.items).toHaveLength(1);
    expect(s.items[0].fix?.template).toBe("sales");
  });

  it("banking asks for what the bank needs: history, repayments, rate, request", () => {
    const b = bankingReadiness({ ...company(ps("2026-01", 12)), assumptions: { rate: 24 } });
    expect(b.items.find((i) => i.id === "rate")!.status).toBe("done");
    expect(b.items.find((i) => i.id === "request")!.status).toBe("missing");
    expect(b.items.find((i) => i.id === "history")!.completion).toBe(50);
  });

  it("forecast needs consecutive months and a starting balance sheet", () => {
    const f = forecastReadiness(company(ps("2026-01", 12)));
    expect(f.items.find((i) => i.id === "run")!.completion).toBe(100);
    expect(f.items.find((i) => i.id === "drivers")!.status).toBe("missing");
    expect(readiness(company(ps("2026-01", 3))).map((r) => r.key)).toEqual(["financials", "sales", "expenses", "banking", "forecast"]);
  });

  it("expenses: the demo's lines tie to its P&L costs; with no lines, the next step is the General Ledger", () => {
    const d = demoCompany();
    const r = expensesReadiness({ months: d.months, checks: [], fyStart: 1, expenses: demoExpenses(), today: "2026-10-12" });
    expect(r.items.find((i) => i.id === "reconciled")).toMatchObject({ completion: 100, accuracy: 100 });
    expect(r.items.find((i) => i.id === "loaded")!.completion).toBe(100);
    expect(r.items.find((i) => i.id === "types")!.completion).toBe(100);
    const none = expensesReadiness({ months: d.months, checks: [], fyStart: 1, expenses: null });
    expect(none.items).toHaveLength(1);
    expect(none.items[0].fix?.what).toBe("Upload your General Ledger");
  });
});
