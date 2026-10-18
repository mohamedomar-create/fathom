// The Payments upload: each sheet is an ageing report, a payments list, or neither (named); the problems that block saving.
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { planPaymentsUpload } from "@/lib/ingest/payments-upload";

const _ = null;
const aged = (side: "Receivable" | "Payable", total = 600): Grid => ({ name: `Aged ${side}`, rows: [[_, "As of 09/30/2026"], [], [_, "Invoice Date", "At Date", "1-30", "31-60", "61-90", "91-120", "Older", "Total"],
  [`Aged ${side}`, _, total, _, _, _, _, _, total], ["Medline", _, total, _, _, _, _, _, total], ["BILL/1", "09/01/2026", total, _, _, _, _, _, _], ["Total Medline", _, total, _, _, _, _, _, total], [`Total Aged ${side}`, _, total, _, _, _, _, _, total]] });
const payments: Grid = { name: "Sheet1", rows: [["Date", "Number", "Journal", "Payment Method", "Customer/Vendor", "Amount Signed", "Currency", "Amount Company Currency Signed", "State"],
  ["09/30/2026", "CIB/1", "CIB", "Manual", "Northside", 100, "EGP", 100, "Paid"], ["08/30/2026", "CIB/0", "CIB", "Manual", "Northside", 50, "EGP", 50, "Paid"]] };

describe("Payments upload plan", () => {
  it("sorts the sheets: two ageing reports, one payments list, the months they cover; other sheets named", () => {
    const p = planPaymentsUpload([{ ...aged("Receivable"), name: "ar.xlsx › Aged Receivable" }, { ...aged("Payable"), name: "ap.xlsx › Aged Payable" }, { ...payments, name: "pay.xlsx › Sheet1" }, { name: "x.xlsx › Notes", rows: [["hello"]] }]);
    expect(p.aged.map((a) => [a.report.side, a.report.asOf, a.sheet])).toEqual([["receivable", "2026-09-30", "ar.xlsx › Aged Receivable"], ["payable", "2026-09-30", "ap.xlsx › Aged Payable"]]);
    expect(p.payments.lines.length).toBe(2);
    expect(p.payments.periods).toEqual(["2026-08", "2026-09"]);
    expect(p.unread).toEqual(["x.xlsx › Notes"]);
    expect(p.errors).toEqual([]);
  });
  it("two reports for the same side and date, or a report that doesn't add up, block saving", () => {
    expect(planPaymentsUpload([aged("Receivable"), { ...aged("Receivable"), name: "copy" }]).errors.join(" ")).toMatch(/two Aged Receivable reports/i);
    const bad = aged("Payable");
    bad.rows[7][2] = 999;
    expect(planPaymentsUpload([bad]).errors.length).toBeGreaterThan(0);
  });
});
