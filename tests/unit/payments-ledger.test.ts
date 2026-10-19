// Payments in and out from the General Ledger: every entry on a bank or cash account, named by the other side of its own
// journal entry (customers, suppliers, between own accounts, or the class it went to), and checked against the accounts.
import { describe, expect, it } from "vitest";
import { ledgerCashMoves, paymentsFromLedger } from "@/lib/ingest/payments";

const e = (ref: string, day: string, amount: number, partner = "", label = "") => ({ day, period: day.slice(0, 7), ref, label, partner, amount });
const ledger = () => [
  { code: "121221", name: "CIB Bank EGP", cls: "cash", excluded: false, entries: [
    e("CIB/2026/0001", "2026-09-05", 3000, "Northside"), e("CIB/2026/0002", "2026-09-06", -1500, "Medline"),
    e("TRF/2026/0001", "2026-09-07", -2000), e("CIB/2026/0003", "2026-09-08", -50, "", "Bank charges"),
    e("CIB/2026/0004", "2026-09-09", -1100, "Medline"), e("CIB/2026/0005", "2026-09-10", 700, "Delta"),
  ] },
  { code: "121102", name: "petty Mazen", cls: "cash", excluded: false, entries: [e("TRF/2026/0001", "2026-09-07", 2000)] },
  { code: "122200", name: "Trade Receivables", cls: "ar", excluded: false, entries: [e("CIB/2026/0001", "2026-09-05", -3000, "Northside")] },
  { code: "122100", name: "Notes Receivable", cls: "ar", excluded: false, entries: [e("CIB/2026/0005", "2026-09-10", -700, "Delta")] },
  { code: "211100", name: "Suppliers", cls: "ap", excluded: false, entries: [e("CIB/2026/0002", "2026-09-06", 1500, "Medline"), e("CIB/2026/0004", "2026-09-09", 1000, "Medline")] },
  { code: "522015", name: "Bank charges", cls: "interest_expenses", excluded: false, entries: [e("CIB/2026/0003", "2026-09-08", 50), e("CIB/2026/0004", "2026-09-09", 100)] },
];

describe("payments from the General Ledger", () => {
  it("names each bank and cash entry by the other side of its journal entry", () => {
    const r = paymentsFromLedger(ledger());
    expect(r.errors).toEqual([]);
    expect(r.lines.map((l) => [l.number, l.journal, l.direction, l.amount, l.kind, l.counter, l.partner])).toEqual([
      ["CIB/2026/0001", "121221 CIB Bank EGP", "in", 3000, "customers", "ar", "Northside"],
      ["CIB/2026/0002", "121221 CIB Bank EGP", "out", -1500, "suppliers", "ap", "Medline"],
      ["TRF/2026/0001", "121221 CIB Bank EGP", "out", -2000, "transfer", "", ""],
      ["CIB/2026/0003", "121221 CIB Bank EGP", "out", -50, "other", "interest_expenses", ""],
      // A mixed entry is named by its largest other side.
      ["CIB/2026/0004", "121221 CIB Bank EGP", "out", -1100, "suppliers", "ap", "Medline"],
      // A cheque cleared from Notes Receivable is a customer collection.
      ["CIB/2026/0005", "121221 CIB Bank EGP", "in", 700, "customers", "ar", "Delta"],
      ["TRF/2026/0001", "121102 petty Mazen", "in", 2000, "transfer", "", ""],
    ]);
    expect(r.lines.every((l) => l.state === "paid" && l.period === "2026-09")).toBe(true);
  });

  it("every month's lines add up to the cash accounts' movement; when they don't, it is an error naming the account", () => {
    const moves = { "121221 CIB Bank EGP": { "2026-09": -950 }, "121102 petty Mazen": { "2026-09": 2000 } };
    expect(paymentsFromLedger(ledger(), moves).errors).toEqual([]);
    const off = paymentsFromLedger(ledger(), { ...moves, "121102 petty Mazen": { "2026-09": 2500 } });
    expect(off.errors.join(" ")).toMatch(/121102 petty Mazen.*2026-09.*2,000\.00.*2,500\.00/);
  });

  it("excluded and computed lines are left out; without bank or cash accounts there is nothing", () => {
    const ls = ledger().map((l) => (l.cls === "cash" ? { ...l, excluded: true } : l));
    expect(paymentsFromLedger(ls).lines).toEqual([]);
  });

  it("each cash account's movement per month comes from its balances (the first month is the opening)", () => {
    const ls = [{ code: "121221", name: "CIB Bank EGP", cls: "cash", excluded: false, values: { "2026-08": 10000, "2026-09": 9050, "2026-10": 9050 } },
      { code: "122200", name: "Trade Receivables", cls: "ar", excluded: false, values: { "2026-08": 1, "2026-09": 2 } }];
    expect(ledgerCashMoves(ls)).toEqual({ "121221 CIB Bank EGP": { "2026-09": -950, "2026-10": 0 } });
  });
});
