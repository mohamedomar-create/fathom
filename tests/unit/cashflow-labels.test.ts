// Cash-flow lines show their cash effect (fix plan 5.1, register D24): the sign word follows the amount.
import { describe, expect, it } from "vitest";
import { bsCalc, cashWaterfall, plCalc } from "@/lib/engine";

describe("cash-flow labels", () => {
  it("receivables falling, tax owed rising and net interest earned read as cash in, with honest names", () => {
    const P = plCalc({ revenue: 1000, cos_variable: 400, interest_income: 50, interest_expenses: 10 });
    const B0 = bsCalc({ cash: 100, ar: 500, tax_liab: 100, other_equity: 500 });
    const B = bsCalc({ cash: 1240, ar: 300, tax_liab: 200, other_equity: 500, retained_earnings: 640 });
    const rows = cashWaterfall(P, B, B0).rows;
    const row = (re: RegExp) => rows.find((r) => re.test(r.label))!;
    expect(row(/Accounts Receivable/)).toMatchObject({ sign: "ADD", value: 200 });
    expect(row(/^Tax/)).toMatchObject({ label: "Tax paid, net of the change in tax owed (incl. VAT)", sign: "ADD", value: 100 });
    expect(row(/Net Interest/)).toMatchObject({ label: "Net Interest Received", sign: "ADD", value: 40 });
  });
});

describe("bank charges shown under interest are said so (register D31)", () => {
  it("names the bank-charge accounts the company classed as interest; none when they are operating", async () => {
    const { bankChargesAsInterest } = await import("@/lib/engine");
    const accts = [{ name: "Bank charges", cls: "interest_expenses" }, { name: "Loan interest", cls: "interest_expenses" }, { name: "Bank fees", cls: "exp_variable" }];
    expect(bankChargesAsInterest(accts)).toEqual(["Bank charges"]);
    expect(bankChargesAsInterest([{ name: "Bank charges", cls: "exp_variable" }])).toEqual([]);
  });
});

describe("retained earnings split (register D33)", () => {
  it("prior years and the current year to date add up to the balance", async () => {
    const { splitRetained } = await import("@/lib/engine");
    expect(splitRetained(77_524_756, 7_668_300)).toEqual({ prior: 69_856_456, current: 7_668_300 });
  });
});
