// Payments readiness: each ageing report loaded and tied to its control account at the as-of month, and the payments list loaded.
import { describe, expect, it } from "vitest";
import { buildMonths } from "@/lib/company/build";
import { paymentsReadiness, readiness } from "@/lib/company/readiness";
import type { AccountLine } from "@/lib/company/types";
import { EMPTY_PAYMENTS, type PaymentsData } from "@/lib/engine/payments";

const B = ["At Date", "1-30", "31-60", "61-90", "91-120", "Older"];
const aged = (total: number) => ({ asOf: "2026-09-30", buckets: B, findings: [], total: { amounts: [total, 0, 0, 0, 0, 0], total }, items: [{ partner: "Delta", ref: "INV/1", memo: "", day: null, amounts: [total, 0, 0, 0, 0, 0], total }] });
const accounts: AccountLine[] = [
  { id: "1", code: "122200", name: "Trade Receivables", cls: "ar", amounts: { "2026-09": 2500 } },
  { id: "2", code: "211100", name: "Suppliers", cls: "ap", amounts: { "2026-09": 300 } },
];
const base = { months: buildMonths(accounts), checks: [], fyStart: 1, accounts };
const pay: PaymentsData["payments"] = [{ day: "2026-09-05", number: "CIB/1", journal: "CIB", method: "Manual", partner: "Delta", amount: 3000, currency: "EGP", amountCurrency: 3000, state: "paid" }];

describe("Payments readiness", () => {
  it("nothing loaded: every item missing, with the upload to do", () => {
    const r = paymentsReadiness({ ...base, payments: { data: EMPTY_PAYMENTS } });
    expect(r.key).toBe("payments");
    expect(r.completion).toBe(0);
    expect(r.items.map((i) => i.id)).toEqual(["aged_receivable", "aged_payable", "payments"]);
    expect(r.items.every((i) => i.status === "missing" && i.fix?.href === "settings/source-data?step=payments")).toBe(true);
  });

  it("both ageing reports tied to the books and payments loaded: done, 100% accurate", () => {
    const r = paymentsReadiness({ ...base, payments: { data: { aged: { receivable: aged(2500), payable: aged(300) }, payments: pay } } });
    expect(r.completion).toBe(100);
    expect(r.accuracy).toBe(100);
    expect(r.items.find((i) => i.id === "aged_receivable")!.detail).toMatch(/agrees with 122200 Trade Receivables/);
  });

  it("an ageing report that differs from its account is loaded but not accurate, and names the difference", () => {
    const r = paymentsReadiness({ ...base, payments: { data: { aged: { receivable: aged(2400) }, payments: [] } } });
    const ar = r.items.find((i) => i.id === "aged_receivable")!;
    expect(ar.completion).toBe(100);
    expect(ar.accuracy).toBe(0);
    expect(ar.status).toBe("partial");
    expect(ar.detail).toMatch(/differs from the books by -100/);
  });

  it("an ageing report with no books for its month cannot be checked yet", () => {
    const r = paymentsReadiness({ ...base, months: [], accounts: [], payments: { data: { aged: { payable: aged(300) }, payments: [] } } });
    const ap = r.items.find((i) => i.id === "aged_payable")!;
    expect(ap.completion).toBe(100);
    expect(ap.accuracy).toBeNull();
    expect(ap.detail).toMatch(/no balance in the books/i);
  });

  it("the sector list carries Payments only when its data is given", () => {
    expect(readiness(base).map((s) => s.key)).not.toContain("payments");
    expect(readiness({ ...base, payments: { data: EMPTY_PAYMENTS } }).map((s) => s.key)).toContain("payments");
  });
});

describe("Payments readiness on the demo company", () => {
  it("the demo ageing reports tie to the demo balance sheet and its payments are loaded", async () => {
    const { demoCompany } = await import("@/lib/company/demo");
    const { demoPayments } = await import("@/lib/company/demo-payments");
    const d = demoCompany();
    const r = paymentsReadiness({ months: d.months, checks: [], fyStart: d.settings.fyStartMonth, accounts: d.accounts, payments: { data: demoPayments() } });
    expect(r.items.map((i) => [i.id, i.status])).toEqual([["aged_receivable", "done"], ["aged_payable", "done"], ["payments", "done"]]);
  });
});
