// Odoo prints many reports besides the account balances (ageing, partner statements, the cash flow statement, VAT, the
// asset register…). Uploaded as accounts, their figures would be read as account balances: each one is recognised, named
// and left out, with where it belongs; the balance exports (Trial Balance, General Ledger, Balance Sheet, P&L) are read.
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { ingest, type IngestOptions } from "@/lib/ingest/pipeline";
import { otherOdooReport } from "@/lib/ingest/odoo-reports";
import { guessRole } from "@/lib/ingest/roles";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-18" };
const _ = null;
const sheet = (name: string, rows: unknown[][]): Grid => ({ name, rows: rows as Grid["rows"] });

const REPORTS: [string, Grid][] = [
  ["Aged Payable", sheet("Aged Payable", [[_, "As of 09/30/2026"], [], [_, "Invoice Date", "At Date", "1-30", "31-60", "61-90", "91-120", "Older", "Total"], ["Aged Payable", _, 500, 100, _, _, _, _, 600], ["Medline", _, 500, 100, _, _, _, _, 600], ["BILL/2026/0001", "09/01/2026", 500, 100, _, _, _, _, _], ["Total Medline", _, 500, 100, _, _, _, _, 600], ["Total Aged Payable", _, 500, 100, _, _, _, _, 600]])],
  ["Cash Flow Statement", sheet("Cash Flow Statement", [[_, _, "Sep 2026"], [], ["Code", "Account Name", "Balance"], [_, "Cash and cash equivalents, beginning of period", -100], ["121101", "Main Cash Safe", 50], ["211501", "Facilities", -150], [_, "Net increase in cash and cash equivalents", 20], [_, "Cash and cash equivalents, closing balance", -80]])],
  ["Customer Statement", sheet("Customer Statement", [[_, "Sep 2026"], [], [_, "Invoice Date", "Due Date", "Amount", "Amount Currency", "Balance"], ["Northside", _, _, 100, _, 100], ["Initial Balance", _, _, 60, _, 60], ["INV/2026/0001", "09/01/2026", "09/30/2026", 40, _, 100], ["Total Northside", _, _, 100, _, 100], ["Total", _, _, 100, _, 100]])],
  ["Partner Ledger", sheet("Partner Ledger", [[_, "Sep 2026"], [], [_, "Journal", "Account", "Invoice Date", "Due Date", "Matching", "Debit", "Credit", "Amount Currency", "Balance"], ["Northside", _, _, _, _, _, 100, 0, _, 100], ["INV/2026/0001", "INV", "122200", "09/01/2026", "09/30/2026", _, 100, _, _, 100], ["Total Northside", _, _, _, _, _, 100, 0, _, 100]])],
  ["Follow-Up Report", sheet("Follow-Up Report", [[_, "As of 09/30/2026"], [], [_, "Invoice Date", "Due Date", "Amount", "Amount Currency", "Balance"], ["Airtech", _, _, 125, _, 125], ["Overdue"], ["BMISR/2021/0250", "12/09/2021", "12/09/2021", 125, 801, 125], ["Total Airtech", _, _, 125, _, 125]])],
  ["Executive Summary", sheet("Executive Summary", [[_, "Sep 2026"], [], [_, "Balance"], [], ["Cash"], ["Cash received", 34230393.98], ["Cash spent", -34737967.77], ["Cash surplus", -507744.43], ["Closing bank balance", 20430028.66], ["Profitability"], ["Revenue", 20203737.17], ["Net Profit", 9069788.51]])],
  ["Generic Tax report", sheet("Generic Tax report", [[_, "Sep 2026"], [], [_, "Net", "Tax"], [], ["Sales", _, 1871987.90], ["VAT Out (14.0%)", 12287064.04, 1720263.32], ["Total Sales", _, 1871987.90]])],
  ["Group by Account > Tax", sheet("Group by Account > Tax ", [[_, "Sep 2026"], [], [_, "Net", "Tax"], [], ["Sales", _, 100], ["4 Reveneus", _, 100], ["VAT Out (14.0%)", 714.29, 100], ["Total Sales", _, 100]])],
  ["Depreciation Schedule", sheet("Depreciation Schedule", [[_, _, "Sep 2026"], [_, _, "Characteristics", _, _, _, "Assets", _, _, _, "Depreciation"], ["Code", "Account Name", "Acquisition Date", "First Depreciation", "Method", "Duration / Rate", "09/01/2026", "+", "-", "09/30/2026", "09/01/2026", "+", "-", "09/30/2026", _], ["111201", "Assets - Lap Tops", _, _, _, _, 285875.33, 0, 0, 285875.33, 243186.50, 2950.45, 0, 296156.5, 40100.99]])],
  ["Unrealized Currency Gains/Losses", sheet("Unrealized Currency GainsLosse", [[_, "As of 09/30/2026"], [], [_, "Balance in Foreign Currency", "Currency Code", "Balance at Operation Rate", "Balance at Current Rate", "Adjustment"], ["Accounts To Adjust"], ["USD (1 EGP = 50.0497 USD)", "-315766.37", "USD", -13791909.52, -5414.27, 13786715.66]])],
  ["Journal Report", sheet("Customer Invoices in Tax", [["Document", "Account Code", "Account Label", "Name", "Debit", "Credit", "Taxes"], ["INV/2026/0299", "122200", "Customer", "INV/2026/0299", "2,500.00 E£", "0.00 E£"], [46266, "410000", "Revenues", "Breas VIVO 2", "0.00 E£", "2,500.00 E£"]])],
];

describe("Odoo reports that are not account balances", () => {
  for (const [title, g] of REPORTS) {
    it(`${title}: named, left out of the accounts, never read as balances`, () => {
      expect(otherOdooReport(g)?.title).toBe(title);
      expect(guessRole(g)).toMatchObject({ role: "summary" });
      const res = ingest([g], OPTS);
      expect(res.lines.filter((l) => !l.excluded)).toEqual([]);
      expect(res.layouts[0]).toMatchObject({ kind: "skipped" });
      expect(res.issues.warnings.join(" ")).toContain(title);
    });
  }

  it("the balance exports themselves are not mistaken for one", () => {
    const tb = sheet("Trial Balance", [[_, _, "Initial Balance", _, "Sep 2026", _, "End Balance", _], [], ["Code", "Account Name", "Debit", "Credit", "Debit", "Credit", "Debit", "Credit"], ["121101", "Cash", 100, _, 50, _, 150, _], ["340000", "Capital", _, 100, _, 50, _, 150], [_, "Total", 100, 100, 50, 50, 150, 150]]);
    const bs = sheet("Balance Sheet", [[_, _, "As of 09/30/2026"], [], ["Code", "Account Name", "Balance"], [_, "ASSETS", 100], ["121101", "Cash", 100]]);
    const pl = sheet("Profit and Loss", [[_, _, "Sep 2026"], [], ["Code", "Account Name", "Balance"], [_, "Revenue", 100], ["410000", "Revenues", 100], [_, "Net Profit", 100]]);
    const gl = sheet("General Ledger", [[_, _, "Sep 2026"], [], ["Code", "Account Name", "Date", "Communication", "Partner", "Currency", "Debit", "Credit", "Balance"], ["121101", "Cash", _, _, _, _, 100, _, 100]]);
    for (const g of [tb, bs, pl, gl]) expect(otherOdooReport(g)).toBeNull();
  });
});
