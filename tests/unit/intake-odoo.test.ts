// The Odoo export set through the intake: each report reaches the reader built for it, never a generic list reading.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkbook } from "@/lib/ingest/read";
import { planIntake } from "@/lib/intake/plan";

const file = (n: string) => path.join(__dirname, "../fixtures/files", n);
const plan = async (n: string) => { const b = fs.readFileSync(file(n)); return planIntake(await readWorkbook(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, n)); };

describe("the Odoo export set", () => {
  it("reads Odoo's Aged Receivable and Aged Payable with their own reader", async () => {
    for (const [n, side] of [["odoo-aged-receivable.xlsx", "ar_open"], ["odoo-aged-payable.xlsx", "ap_open"]] as const) {
      const p = (await plan(n)).pieces.filter((x) => x.layout === "odoo_aged");
      expect(p.length, n).toBe(1);
      expect(p[0].module).toBe(side);
      expect(p[0].aged?.errors).toEqual([]);
    }
  });

  it("sends the ledger, trial balance and statements to the accounts step, never to a list module", async () => {
    for (const n of ["egypt-odoo-general-ledger.xlsx", "egypt-odoo-trial-balance.xlsx", "odoo-pl-bs.xlsx", "odoo-trial-balance.xlsx", "egypt-odoo-profit-and-loss.xlsx"]) {
      const p = await plan(n);
      for (const x of p.pieces) expect([x.layout, x.module], `${n} ${x.id}`).toEqual(["statement", null]);
    }
  });

  it("places Odoo's invoice analysis in Sales and its vendor bills in Expenses, every row accounted for", async () => {
    const s = (await plan("odoo-invoice-analysis.xlsx")).pieces.filter((x) => x.read);
    expect(s.map((x) => x.module)).toContain("sales");
    const b = (await plan("odoo-vendor-bills.xlsx")).pieces.filter((x) => x.read);
    expect(b.map((x) => x.module)).toContain("expenses");
    for (const x of [...s, ...b]) expect(x.read!.proof.ok, x.id).toBe(true);
  });

  it("reads Odoo's payments list with its own reader", async () => {
    const p = (await plan("odoo-payments.xlsx")).pieces;
    expect(p.some((x) => x.layout === "odoo_payments")).toBe(true);
  });
});
