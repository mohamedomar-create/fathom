// Odoo 18's Balance Sheet, as exported: Odoo's sections (Bank and Cash Accounts, Receivables, Current Assets, Payables,
// Unallocated Earnings…) each repeat the account-group rows, a credit balance in the assets section is printed negative
// there, and the computed equity lines (current and previous years' earnings) have no account code.
import { describe, expect, it } from "vitest";
import { runChecks } from "@/lib/company/checks";
import type { Grid } from "@/lib/ingest/extract";
import { ingest, toAccountInputs, type IngestOptions } from "@/lib/ingest/pipeline";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-18" };
const _ = null;
function balanceSheet(): Grid[] {
  return [{ name: "Balance Sheet", rows: [
    [_, _, "As of 09/30/2026"], [],
    ["Code", "Account Name", "Balance"], [],
    [_, "ASSETS", 1000],
    [_, "Current Assets", 1000],
    [_, "Bank and Cash Accounts", 2000],
    [_, "1 Assets", 2000], [_, "12 Current Assets", 2000], [_, "121 Cash & Cash Equivalent", 2000],
    ["121221", "CIB Bank EGP", 1700],
    ["121270", "Checks Under Collection", 300],
    [_, "Total 121 Cash & Cash Equivalent", 2000], [_, "Total 12 Current Assets", 2000], [_, "Total 1 Assets", 2000],
    [_, "Total Bank and Cash Accounts", 2000],
    [_, "Current Assets", -1000],
    [_, "(No Group)", -1000],
    ["w.2", "Stock Interim (Received)", -1000],
    [_, "Total (No Group)", -1000],
    [_, "Total Current Assets", -1000],
    [_, "Total Current Assets", 1000],
    [_, "Total ASSETS", 1000],
    [_, "LIABILITIES", 500],
    [_, "Current Liabilities", 500],
    [_, "Payables", 500], [_, "2 Liabilities", 500], [_, "211 Payable", 500],
    ["211100", "Suppliers", 500],
    [_, "Total 211 Payable", 500], [_, "Total 2 Liabilities", 500], [_, "Total Payables", 500],
    [_, "Total Current Liabilities", 500],
    [_, "Total LIABILITIES", 500],
    [_, "EQUITY", 500],
    [_, "Unallocated Earnings", 500],
    [_, "Current Year Unallocated Earnings", 300],
    [_, "Previous Years Unallocated Earnings", 200],
    [_, "Total Unallocated Earnings", 500],
    [_, "Retained Earnings", 0],
    [_, "Current Year Retained Earnings", -100],
    [_, "3 Owners Equity", -100],
    ["340000", "Owners Current Account", -100],
    [_, "Total 3 Owners Equity", -100],
    [_, "Total Current Year Retained Earnings", -100],
    [_, "Previous Years Retained Earnings", 100],
    [_, "Total Retained Earnings", 0],
    [_, "Total EQUITY", 500],
    [_, "LIABILITIES + EQUITY", 1000],
  ] }, { name: "Filters", rows: [["Company", "Sample Trading Co"]] }];
}

describe("Odoo 18 Balance Sheet", () => {
  const res = ingest(balanceSheet(), OPTS);
  it("keeps the computed equity lines that have no account code (current and previous years' earnings)", () => {
    const names = res.lines.filter((l) => !l.excluded).map((l) => l.name);
    expect(names).toEqual(expect.arrayContaining(["Checks Under Collection", "Current Year Unallocated Earnings", "Previous Years Unallocated Earnings", "Previous Years Retained Earnings"]));
    expect(names).not.toEqual(expect.arrayContaining(["Unallocated Earnings", "Retained Earnings", "Current Assets", "ASSETS"]));
  });
  it("a credit balance printed negative in the assets section keeps its meaning whatever class it gets: the balance sheet balances", () => {
    expect(Math.abs(res.imbalance["2026-09"] ?? 0)).toBeLessThan(0.01);
    const checks = runChecks({ accounts: toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) })), controls: res.controls, extra: res.checks });
    expect(checks.filter((c) => c.id === "bs_balance")).toEqual([]);
  });
});

// Odoo 18's Profit and Loss: account groups ("4 Reveneus", "(No Group)") nested inside Odoo's sections, with the exchange
// gain under Revenue, as Odoo prints it.
function profitAndLoss(): Grid[] {
  return [{ name: "Profit and Loss", rows: [
    [_, _, "Sep 2026"], [],
    ["Code", "Account Name", "Balance"],
    [_, "Revenue", 1100],
    [_, "4 Reveneus", 1000], ["410000", "Revenues", 1000], [_, "Total 4 Reveneus", 1000],
    [_, "(No Group)", 100], ["z.33", "Foreign Exchange Gain", 100], [_, "Total (No Group)", 100],
    [_, "Total Revenue", 1100],
    [_, "Less Costs of Revenue", 400],
    [_, "5 Expenses", 400], [_, "51 Cost Of Good Sold", 400], ["510000", "Cost of Goods Sold", 400], [_, "Total 51 Cost Of Good Sold", 400], [_, "Total 5 Expenses", 400],
    [_, "Total Less Costs of Revenue", 400],
    [_, "Gross Profit", 700],
    [_, "Less Operating Expenses", 200],
    [_, "5 Expenses", 200], [_, "52 General & Adminstration Cost", 200], ["521100", "Salaries", 200], [_, "Total 52 General & Adminstration Cost", 200], [_, "Total 5 Expenses", 200],
    [_, "Total Less Operating Expenses", 200],
    [_, "Net Profit", 500],
  ] }, { name: "Filters", rows: [["Company", "Sample Trading Co"]] }];
}

describe("Odoo 18 Profit and Loss", () => {
  const res = ingest(profitAndLoss(), OPTS);
  it("the exchange gain under Revenue is other income, and the file's gross profit (which counts it) is checked as mapped: no mismatch", () => {
    expect(res.lines.find((l) => l.code === "z.33")?.cls).toBe("other_income");
    const checks = runChecks({ accounts: toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) })), controls: res.controls, extra: res.checks });
    expect(checks.filter((c) => c.id === "control_total")).toEqual([]);
  });
});

// The Trial Balance behind the balance sheet above: Odoo's balance sheet splits the owners' account into this year's
// movement and previous years' balance, and shows earnings as computed lines, so equity agrees only in total.
function trialBalance(): Grid[] {
  return [{ name: "Trial Balance", rows: [
    [_, _, "Initial Balance", _, "Sep 2026", _, "End Balance", _], [],
    ["Code", "Account Name", "Debit", "Credit", "Debit", "Credit", "Debit", "Credit"],
    ["121221", "CIB Bank EGP", 1500, _, 300, 100, 1700, _],
    ["121270", "Checks Under Collection", 300, _, _, _, 300, _],
    ["w.2", "Stock Interim (Received)", _, 1000, _, _, _, 1000],
    ["211100", "Suppliers", _, 500, _, _, _, 500],
    ["340000", "Owners Current Account", _, 100, 100, _, _, _],
    ["99999", "Undistributed Profits/Losses", _, 200, _, _, _, 200],
    ["410000", "Revenues", _, _, _, 300, _, 300],
    [_, "Total", 1800, 1800, 400, 400, 2000, 2000],
  ] }, { name: "Filters", rows: [["Company", "Sample Trading Co"]] }];
}

describe("Trial Balance and Balance Sheet uploaded together", () => {
  const named = (n: string, gs: Grid[]) => gs.map((g) => ({ ...g, name: `${n} › ${g.name}` }));
  const res = ingest([...named("tb.xlsx", trialBalance()), ...named("bs.xlsx", balanceSheet())], OPTS);
  const checks = runChecks({ accounts: toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) })), controls: res.controls, extra: res.checks });
  it("the balance sheet for the same month checks the trial balance instead of being imported twice", () => {
    expect(res.layouts.find((l) => l.sheet === "bs.xlsx › Balance Sheet")?.role).toBe("check");
    expect(res.lines.some((l) => l.sheet.startsWith("bs.xlsx"))).toBe(false);
  });
  it("every account agrees, equity in total, the file's total assets as mapped: nothing blocks", () => {
    expect(checks.filter((c) => c.severity === "block")).toEqual([]);
    expect(res.issues.notes.join(" ")).toMatch(/bs\.xlsx › Balance Sheet.*account figures agree/);
  });
  it("a real difference is still caught", () => {
    const bs = balanceSheet();
    bs[0].rows = bs[0].rows.map((r) => (r[0] === "211100" ? ["211100", "Suppliers", 600] : r));
    const bad = ingest([...named("tb.xlsx", trialBalance()), ...named("bs.xlsx", bs)], OPTS);
    expect(bad.checks.find((c) => c.id === "cross_check")?.detail).toMatch(/Suppliers/);
  });
});
