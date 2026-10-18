// The Payments engine: ageing by partner (not due, overdue, over 90 days), concentration, partners in credit, collections
// and payments by month and journal, days to collect, and the ageing tied to its control account in the books.
import { describe, expect, it } from "vitest";
import { paymentsAnalysis, suggestControl, type PaymentsData } from "@/lib/engine/payments";

const B = ["At Date", "1-30", "31-60", "61-90", "91-120", "Older"];
const item = (partner: string, ref: string, amounts: number[]) => ({ partner, ref, memo: "", day: null, amounts, total: amounts.reduce((a, b) => a + b, 0) });
function data(): PaymentsData {
  return {
    aged: {
      receivable: {
        asOf: "2026-09-30", buckets: B, findings: [], total: { amounts: [1000, 500, 0, 0, 300, 700], total: 2500 },
        items: [item("Northside", "INV/1", [1000, 0, 0, 0, 0, 0]), item("Northside", "INV/2", [0, 500, 0, 0, 0, 0]), item("Delta", "INV/3", [0, 0, 0, 0, 300, 800]), item("Delta", "RINV/1", [0, 0, 0, 0, 0, -100])],
      },
      payable: { asOf: "2026-09-30", buckets: B, findings: [], total: { amounts: [400, 0, 0, 0, 0, -100], total: 300 }, items: [item("Medline", "BILL/1", [400, 0, 0, 0, 0, 0]), item("Aerogen", "PAY/1", [0, 0, 0, 0, 0, -100])] },
    },
    payments: [
      { day: "2026-09-05", number: "CIB/1", journal: "CIB Bank", method: "Manual", partner: "Northside", amount: 3000, currency: "EGP", amountCurrency: 3000, state: "paid" },
      { day: "2026-09-30", number: "N/R/1", journal: "Notes Receivables", method: "Manual", partner: "Delta", amount: 1000, currency: "EGP", amountCurrency: 1000, state: "in_process" },
      { day: "2026-09-20", number: "PM/1", journal: "Cash", method: "Manual", partner: "Medline", amount: -1500, currency: "EGP", amountCurrency: -1500, state: "paid" },
      { day: "2026-08-20", number: "PM/0", journal: "Cash", method: "Manual", partner: "Medline", amount: -200, currency: "EGP", amountCurrency: -200, state: "paid" },
    ],
  };
}
const SEP = { type: "month" as const, end: "2026-09" };
const accounts = [
  { code: "122200", name: "Trade Receivables", cls: "ar", amounts: { "2026-09": 2500 } },
  { code: "122100", name: "Notes Receivable", cls: "ar", amounts: { "2026-09": 900 } },
  { code: "211100", name: "Suppliers", cls: "ap", amounts: { "2026-09": 300 } },
];

describe("Payments engine", () => {
  const a = paymentsAnalysis(data(), SEP, 1, { accounts, revenue: { "2026-07": 3000, "2026-08": 3000, "2026-09": 3000 } });
  it("ageing by partner: not yet due, overdue, over 90 days; largest overdue first", () => {
    const r = a.receivable!;
    expect([r.total, r.notDue, r.overdue, r.over90]).toEqual([2500, 1000, 1500, 1000]);
    expect(r.partners.map((p) => [p.name, p.total, p.overdue])).toEqual([["Delta", 1000, 1000], ["Northside", 1500, 500]]);
    expect(a.payable!.credit.map((p) => p.name)).toEqual(["Aerogen"]);
  });
  it("credits sitting in old buckets never make overdue negative: owed, overdue and over 90 days are counted per partner, credits apart", () => {
    const d = data();
    d.aged.receivable!.items.push(item("Unmatched Co", "CIB/9", [0, 0, 0, 0, 0, -5000]), item("Prompt Co", "INV/9", [5000, 0, 0, 0, 0, 0]), item("Unknown", "CIB/8", [0, 0, 0, 0, 0, -50]));
    d.aged.receivable!.total = { amounts: [6000, 500, 0, 0, 300, -4350], total: -2550 };
    const r = paymentsAnalysis(d, SEP, 1).receivable!;
    expect([r.owed, r.credits, r.total]).toEqual([7500, -5050, -2550]);
    expect([r.overdue, r.over90]).toEqual([1500, 1000]);
    expect(r.credit.map((p) => p.name)).toEqual(["Unmatched Co"]);
  });

  it("over 90 days never exceeds what is overdue (a credit in a younger bucket offsets it)", () => {
    const d = data();
    d.aged.receivable!.items = [item("Air Hospital", "INV/7", [150, -100, 0, 0, 0, 300])];
    d.aged.receivable!.total = { amounts: [150, -100, 0, 0, 0, 300], total: 350 };
    const r = paymentsAnalysis(d, SEP, 1).receivable!;
    expect([r.owed, r.notDue, r.overdue, r.over90]).toEqual([350, 150, 200, 200]);
  });

  it("days to collect from the ageing and the last three months' sales", () => {
    expect(a.receivable!.days).toBe(Math.round((2500 / 9000) * 92));
  });
  it("collections and payments in the period, by journal; cheques still in process apart", () => {
    expect(a.flows).toMatchObject({ received: 4000, paid: 1500, net: 2500, inProcess: 1000 });
    expect(a.flows.byJournal.map((j) => [j.journal, j.amount])).toEqual([["CIB Bank", 3000], ["Cash", -1500], ["Notes Receivables", 1000]]);
  });
  it("the ageing ties to its control account; the other receivable accounts are named as not in the ageing", () => {
    const t = a.tieouts.find((x) => x.side === "receivable")!;
    expect(t).toMatchObject({ status: "ok", ageing: 2500, books: 2500, account: "122200 Trade Receivables" });
    expect(t.notInAgeing).toEqual([{ account: "122100 Notes Receivable", amount: 900 }]);
    expect(a.tieouts.find((x) => x.side === "payable")).toMatchObject({ status: "ok", ageing: 300, books: 300 });
  });
  it("a difference names its size and is a risk finding", () => {
    const b = paymentsAnalysis(data(), SEP, 1, { accounts: accounts.map((x) => (x.code === "211100" ? { ...x, amounts: { "2026-09": 280 } } : x)) });
    expect(b.tieouts.find((x) => x.side === "payable")).toMatchObject({ status: "off", diff: 20 });
    expect(b.findings.some((f) => f.kind === "risk" && /payable/i.test(f.title))).toBe(true);
  });
  it("the control account is found by its balance, else by its name; a chosen one wins", () => {
    expect(suggestControl("receivable", 2500, "2026-09", accounts)).toEqual(["122200"]);
    expect(suggestControl("receivable", 1234, "2026-09", accounts)).toEqual(["122200"]);
    expect(paymentsAnalysis(data(), SEP, 1, { accounts, control: { receivable: ["122100"] } }).tieouts.find((x) => x.side === "receivable")).toMatchObject({ status: "off", books: 900 });
  });
});
