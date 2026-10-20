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
    [d("2026-09-30"), "N/R/2026/0038", "Notes Receivables", "Manual (Notes Receivables)", "Northside Hospital", 128500.5, "EGP", 128500.5, "In Process"],
    [d("2026-09-30"), "CIB/2026/1066", "CIB Bank EGP", "Manual (CIB Bank EGP)", "Delta Clinic", 3500, "EGP", 3500, "Paid"],
    [d("2026-09-12"), "AAIB$/2026/0010", "aaib Bank $", "Manual", "Medline Intl", 100, "USD", 5005, "Paid"],
    [d("2026-09-10"), "CIB/2026/0990", "CIB Bank EGP", "Manual (CIB Bank EGP)", "Delta Clinic", 900, "EGP", 900, "Draft"],
    [d("2026-09-01"), "CIB/2026/0938", "CIB Bank EGP", "Manual (CIB Bank EGP)", "شركه النور للتجارة", 45000, "EGP", 45000, "Cancelled"],
  ] };
}

/** The same payments as exported from the list view's Export dialog, with the fields picked by hand. */
describe("reading the Export dialog's payments (Payments (account.payment).xlsx)", () => {
  const want = [["CIB/2026/1066", "in", 3500, "2026-09", "paid"], ["PM/2026/0001", "out", -1200, "2026-09", "in_process"]];
  const rows = (h: string[], recv: string, send: string) => [h,
    [d("2026-09-30"), "CIB/2026/1066", "CIB Bank EGP", "Delta Clinic", 3500, recv, "EGP", "Posted"],
    [d("2026-09-29"), "PM/2026/0001", "Cash", "Medline", 1200, send, "EGP", "In Process"],
    [d("2026-09-28"), "PM/2026/0002", "Cash", "Medline", 50, send, "EGP", "Draft"]];
  const got = (g: Grid) => { const r = readPayments(g, { currency: "EGP" })!; expect(r.errors).toEqual([]); return r.lines.map((l) => [l.number, l.direction, l.amount, l.period, l.state]); };

  it("labels with Amount and Payment Type (Receive / Send) give the direction and sign", () => {
    expect(got({ name: "Sheet1", rows: rows(["Date", "Number", "Journal", "Customer/Vendor", "Amount", "Payment Type", "Currency", "Status"], "Receive", "Send") })).toEqual(want);
  });

  it("technical field names (import-compatible export) are read the same way", () => {
    expect(got({ name: "Sheet1", rows: rows(["date", "name", "journal_id", "partner_id", "amount", "payment_type", "currency_id", "state"], "inbound", "outbound") })).toEqual(want);
  });

  it("Field/Sub-field labels are matched on the field", () => {
    expect(got({ name: "Sheet1", rows: rows(["Date", "Number", "Journal/Display Name", "Customer/Vendor/Display Name", "Amount", "Payment Type", "Currency/Name", "Status"], "Receive", "Send") })).toEqual(want);
  });

  it("an amount in another currency with no company-currency amount is an error naming the row, never counted as EGP", () => {
    const g: Grid = { name: "Sheet1", rows: [["Date", "Number", "Journal", "Customer/Vendor", "Amount", "Payment Type", "Currency", "Status"],
      [d("2026-09-12"), "AAIB$/2026/0010", "aaib Bank $", "Medline Intl", 100, "Receive", "USD", "Posted"]] };
    const r = readPayments(g, { currency: "EGP" })!;
    expect(r.lines).toEqual([]);
    expect(r.errors.join(" ")).toMatch(/Row 2 \(AAIB\$\/2026\/0010\): the amount is in USD.*Amount in Company Currency/);
  });

  it("an unsigned Amount with no Payment Type can't tell money in from money out: not read, and the reason says so", async () => {
    const { paymentsHeadingGap } = await import("@/lib/ingest/payments");
    const g: Grid = { name: "Sheet1", rows: [["Date", "Number", "Journal", "Customer/Vendor", "Amount", "Status"], [d("2026-09-12"), "X/1", "Cash", "A", 10, "Posted"]] };
    expect(readPayments(g)).toBeNull();
    expect(paymentsHeadingGap(g)).toMatch(/Amount Signed or Amount Company Currency Signed, or Amount with Payment Type/);
  });

  it("a sheet that isn't a payments list names the headings it saw", async () => {
    const { paymentsHeadingGap } = await import("@/lib/ingest/payments");
    expect(paymentsHeadingGap({ name: "Sheet1", rows: [["Product", "Quantity", "Price"], ["x", 1, 2]] })).toBeNull();
    const { planPaymentsUpload } = await import("@/lib/ingest/payments-upload");
    expect(planPaymentsUpload([{ name: "x › Sheet1", rows: [["Product", "Quantity", "Price"], ["x", 1, 2]] }]).unread[0].why).toMatch(/headings found: Product, Quantity, Price/);
  });
});

describe("reading Odoo's payments list", () => {
  it("posted payments in company currency, direction from the sign, period from the date", () => {
    const r = readPayments(customers())!;
    expect(r.lines.map((l) => [l.number, l.direction, l.amount, l.period, l.state])).toEqual([
      ["N/R/2026/0038", "in", 128500.5, "2026-09", "in_process"],
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
// Real files are local only: AGED_DIR holds them and an expected.json with their totals; no figures in the repo.
describe.skipIf(!dir)("real Customer / Vendor Payments (local only)", () => {
  const load = async (f: string) => { const b = fs.readFileSync(path.join(dir!, f)); return (await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, f))[0]; };
  const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;
  const want = () => JSON.parse(fs.readFileSync(path.join(dir!, "expected.json"), "utf8")).payments as { file: string; lines: number; total: number; inProcess?: number }[];
  it("each real payments list reads with no errors and matches its private expected totals", async () => {
    for (const w of want()) {
      const r = readPayments(await load(w.file))!;
      expect([r.lines.length, sum(r.lines), r.errors]).toEqual([w.lines, w.total, []]);
      if (w.inProcess !== undefined) expect(sum(r.lines.filter((l) => l.state === "in_process"))).toBe(w.inProcess);
    }
  });
});
