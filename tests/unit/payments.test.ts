// Odoo's Customer Payments / Vendor Payments list (Accounting ▸ Customers ▸ Payments, exported): each payment read in the
// company's currency, its direction from the sign, posted payments counted, drafts and cancelled ones named and left out.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { readPayments } from "@/lib/ingest/payments";
import { readWorkbook } from "@/lib/ingest/read";

const H = ["Date", "Number", "Journal", "Payment Method", "Customer/Vendor", "Amount Signed", "Currency", "Amount Company Currency Signed", "State"];
const d = (s: string) => new Date(`${s}T00:00:00Z`);
function customers(): Grid {
  return { name: "Sheet1", rows: [H,
    [d("2026-09-30"), "N/R/2026/0038", "Notes Receivables", "Manual (Notes Receivables)", "Northside Hospital", 115301.45, "EGP", 115301.45, "In Process"],
    [d("2026-09-30"), "CIB/2026/1066", "CIB Bank EGP", "Manual (CIB Bank EGP)", "Delta Clinic", 3500, "EGP", 3500, "Paid"],
    [d("2026-09-12"), "AAIB$/2026/0010", "aaib Bank $", "Manual", "Medline Intl", 100, "USD", 5005, "Paid"],
    [d("2026-09-10"), "CIB/2026/0990", "CIB Bank EGP", "Manual (CIB Bank EGP)", "Delta Clinic", 900, "EGP", 900, "Draft"],
    [d("2026-09-01"), "CIB/2026/0938", "CIB Bank EGP", "Manual (CIB Bank EGP)", "شركه النور للتجارة", 45000, "EGP", 45000, "Cancelled"],
  ] };
}

describe("reading Odoo's payments list", () => {
  it("posted payments in company currency, direction from the sign, period from the date", () => {
    const r = readPayments(customers())!;
    expect(r.lines.map((l) => [l.number, l.direction, l.amount, l.period, l.state])).toEqual([
      ["N/R/2026/0038", "in", 115301.45, "2026-09", "in_process"],
      ["CIB/2026/1066", "in", 3500, "2026-09", "paid"],
      ["AAIB$/2026/0010", "in", 5005, "2026-09", "paid"],
    ]);
    expect(r.lines[2]).toMatchObject({ currency: "USD", amountCurrency: 100, journal: "aaib Bank $", partner: "Medline Intl", day: "2026-09-12" });
    expect(r.errors).toEqual([]);
  });

  it("drafts and cancelled payments are left out and named; a cheque in process on a notes journal is pointed out", () => {
    const r = readPayments(customers())!;
    expect(r.skipped).toEqual({ draft: { count: 1, amount: 900 }, cancelled: { count: 1, amount: 45000 } });
    expect(r.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["left_out", "in_process"]));
  });

  it("vendor payments are money out (negative sign), whatever the sheet is called", () => {
    const g: Grid = { name: "Sheet1", rows: [H, [d("2026-09-29"), "PC2/2026/00529", "Petty Cash 2", "Manual (Petty Cash 2)", "Sample Employee", -10496, "EGP", -10496, "Paid"]] };
    expect(readPayments(g)!.lines[0]).toMatchObject({ direction: "out", amount: -10496 });
  });

  it("the same payment number twice is an error; an unreadable amount is an error with its row", () => {
    const g = customers();
    g.rows.push([d("2026-09-30"), "CIB/2026/1066", "CIB Bank EGP", "Manual", "Delta Clinic", 3500, "EGP", 3500, "Paid"]);
    g.rows.push([d("2026-09-30"), "CIB/2026/1067", "CIB Bank EGP", "Manual", "Delta Clinic", "abc", "EGP", "abc", "Paid"]);
    const errs = readPayments(g)!.errors.join(" ");
    expect(errs).toMatch(/CIB\/2026\/1066.*twice/);
    expect(errs).toMatch(/Row 8/);
  });

  it("anything else is not read as payments", () => {
    expect(readPayments({ name: "Sheet1", rows: [["Date", "Reference", "Product", "Quantity"], [d("2026-09-01"), "WH/OUT/1", "Mask", 2]] })).toBeNull();
  });
});

const dir = process.env.AGED_DIR;
describe.skipIf(!dir)("real Customer / Vendor Payments (local only)", () => {
  const load = async (f: string) => { const b = fs.readFileSync(path.join(dir!, f)); return (await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, f))[0]; };
  const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  it("the main company Sep 2026: 93 customer payments 10,233,365.74 (in process 1,081,645.46); 77 vendor payments -11,127,843.61", async () => {
    const c = readPayments(await load("customer_payments_2026-09.xlsx"))!;
    expect([c.lines.length, sum(c.lines), sum(c.lines.filter((l) => l.state === "in_process")), c.errors]).toEqual([93, 10233365.74, 1081645.46, []]);
    const v = readPayments(await load("vendor_payments_2026-09.xlsx"))!;
    expect([v.lines.length, sum(v.lines), v.errors]).toEqual([77, -11127843.61, []]);
  });
});
