import { describe, expect, it } from "vitest";
import { balancesCheckOnly, ledgerClear } from "@/lib/company/add-mode";
import { ledgerDrift, driftNotice } from "@/lib/company/ledger-tie";

const touched = ["2026-08", "2026-09"];

describe("D1: 'Update these months' keeps the sales, expense and payment detail", () => {
  it("a Trial Balance or P&L (no ledger lines) clears no detail for the months it updates", () => {
    expect(ledgerClear("merge", { fileHasLedger: false, touchedPL: touched, preStart: [] })).toEqual({ all: false, months: [] });
  });
  it("a General Ledger replaces the detail of its own months only", () => {
    expect(ledgerClear("merge", { fileHasLedger: true, touchedPL: touched, preStart: [] })).toEqual({ all: false, months: touched });
  });
  it("months before the books start always lose their lines (they are no longer in the books)", () => {
    expect(ledgerClear("merge", { fileHasLedger: false, touchedPL: touched, preStart: ["2021-05"] })).toEqual({ all: false, months: ["2021-05"] });
    expect(ledgerClear("add", { fileHasLedger: true, touchedPL: touched, preStart: ["2021-05"] })).toEqual({ all: false, months: ["2021-05"] });
  });
  it("'add only new months' never clears loaded months", () => {
    expect(ledgerClear("add", { fileHasLedger: true, touchedPL: touched, preStart: [] })).toEqual({ all: false, months: [] });
  });
  it("'Replace all' keeps today's behaviour: everything goes", () => {
    expect(ledgerClear("replace", { fileHasLedger: false, touchedPL: touched, preStart: [] })).toEqual({ all: true, months: [] });
  });
});

describe("D1: kept detail that no longer agrees is listed, never deleted", () => {
  const accounts = [
    { cls: "revenue" as const, amounts: { "2026-08": 1000, "2026-09": 2000 } },
    { cls: "exp_fixed" as const, amounts: { "2026-08": 300, "2026-09": 400 } },
  ];
  it("lists each month and kind where the lines differ from the new figures by more than 1 EGP, with the difference", () => {
    const d = ledgerDrift({ sales: { "2026-08": 1000, "2026-09": 1500 }, expenses: { "2026-08": 300.5, "2026-09": 450 } }, accounts);
    expect(d).toEqual([
      { kind: "sales", period: "2026-09", lines: 1500, figures: 2000, diff: -500 },
      { kind: "expenses", period: "2026-09", lines: 450, figures: 400, diff: 50 },
    ]);
  });
  it("says the detail was kept and by how much it differs", () => {
    expect(driftNotice([{ kind: "sales", period: "2026-09", lines: 1500, figures: 2000, diff: -500 }])).toBe(
      "Sales detail for Sep 2026 was kept but differs from the new figures by -500. Upload the General Ledger for that month to bring the detail in line.");
    expect(driftNotice([])).toBeNull();
  });
});

describe("D4: a balances file can be the figures for its months", () => {
  const base = { kind: "accounts", read: true, ledgerFile: false, asFigures: false, setupStep: null, ledgerLoaded: true };
  it("a Trial Balance when the books come from a ledger is a check by default", () => {
    expect(balancesCheckOnly(base)).toBe(true);
  });
  it("chosen as the figures, it is saved as the figures", () => {
    expect(balancesCheckOnly({ ...base, asFigures: true })).toBe(false);
  });
  it("a General Ledger or journal items list is never only a check", () => {
    expect(balancesCheckOnly({ ...base, ledgerFile: true })).toBe(false);
  });
  it("without a ledger loaded, balances are the figures, unless the Trial Balance step asked for a check", () => {
    expect(balancesCheckOnly({ ...base, ledgerLoaded: false })).toBe(false);
    expect(balancesCheckOnly({ ...base, ledgerLoaded: false, setupStep: "tb" })).toBe(true);
  });
});
