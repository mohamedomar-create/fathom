// Invoices and credit notes counted apart (fix plan 4.5, register D23).
import { describe, expect, it } from "vitest";
import { salesAnalysis, summariseSales } from "@/lib/engine/sales";

const line = (doc: string, customer: string, amount: number) => ({ period: "2026-10", doc, series: doc.split("/")[0], customer, product: "P", category: "C", salesperson: "", qty: 1, amount, cost: null });

describe("invoice counts", () => {
  it("credit notes are not invoices; the average invoice is gross invoiced ÷ invoices; refund-only customers are active", () => {
    const d = summariseSales([line("INV/1", "A", 300), line("INV/2", "B", 100), line("RINV/1", "A", -50), line("RINV/2", "Z", -20)]);
    const s = salesAnalysis(d, { type: "month", end: "2026-10" }, 1);
    expect(s.invoices).toBe(2);
    expect(s.creditNotes).toBe(2);
    expect(s.avgInvoice).toBe(200);
    expect(s.customers.active).toBe(3);
    expect(s.total).toBe(330);
  });
});
