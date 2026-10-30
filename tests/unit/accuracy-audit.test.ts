import { describe, expect, it } from "vitest";
import sample from "../../reference/sample.json";
import {
  BANK_LIMITS, bankAssessment, bsCalc, cashFlowStatement, computeKpis, currentPortionOfLoans, forecast, fyStartOf, insights, money, plCalc,
  readMemo, stampMemo, stressTest, stripMemoStamp, twelveMonths, addMonths, type MonthData,
} from "@/lib/engine";
import { companySheets } from "@/lib/export/company-workbook";

/**
 * The accuracy audit: every figure below is worked out by hand. Audited statements for 2024 and 2025, one column a year:
 * 2025: revenue 12.0m, cost of sales 8.0m, expenses 2.0m + 0.3m depreciation, interest 0.45m, tax 0.28125m.
 * EBITDA 2.0m, cash for debt service 2.0m − 0.28125m = 1,718,750.
 */
const annual: MonthData[] = [
  { period: "2024-12",
    pl: { revenue: 9500000, cos_variable: 6500000, exp_fixed: 1700000, exp_depreciation: 250000, interest_expenses: 300000, tax_expenses: 168750 },
    bs: { fixed_assets: 2300000, inventory: 1400000, ar: 2200000, cash: 800000, other_equity: 2000000, retained_earnings: 1100000, ltd: 1000000, std: 900000, ap: 1450000, tax_liab: 250000 } },
  { period: "2025-12",
    pl: { revenue: 12000000, cos_variable: 8000000, exp_fixed: 2000000, exp_depreciation: 300000, interest_expenses: 450000, tax_expenses: 281250 },
    bs: { fixed_assets: 2500000, inventory: 1800000, ar: 3200000, cash: 600000, other_equity: 2000000, retained_earnings: 2068750, ltd: 900000, std: 1400000, ap: 1450000, tax_liab: 281250 } },
];
const basis = twelveMonths(annual, "2025-12");
const with2025 = (pl: MonthData["pl"], bs: MonthData["bs"]): MonthData[] => [annual[0], { period: "2025-12", pl: { ...annual[1].pl, ...pl }, bs: { ...annual[1].bs, ...bs } }];

describe("bank: repayments due in the next 12 months", () => {
  const loans = [
    { name: "Current portion of long-term loans", cls: "std", amounts: { "2025-12": 400000 } },
    { name: "Bank overdraft", cls: "std", amounts: { "2025-12": 1000000 } },
  ];

  it("takes the current portion of long-term loans from the books, not the overdraft", () => {
    expect(currentPortionOfLoans(loans, "2025-12")).toEqual({ amount: 400000, names: ["Current portion of long-term loans"] });
    const a = bankAssessment(basis, { accounts: loans });
    expect(a.principalSource).toBe("current_portion");
    expect(a.principal12m).toBe(400000);
    expect(a.ratios.find((r) => r.key === "dscr")!.value).toBeCloseTo(1718750 / (450000 + 400000), 9);
    expect(a.ratios.find((r) => r.key === "dscr")!.estimate).toContain("Current portion of long-term loans");
  });

  it("reads Arabic names of instalments due", () => {
    expect(currentPortionOfLoans([{ name: "أقساط قروض تستحق خلال عام", cls: "std", amounts: { "2025-12": 50 } }], "2025-12").amount).toBe(50);
    expect(currentPortionOfLoans([{ name: "الجزء المتداول من القروض", cls: "std", amounts: { "2025-12": 70 } }], "2025-12").amount).toBe(70);
  });

  it("without a schedule or a current portion, long-term loans over five years, whatever tenor a new loan has", () => {
    const five = bankAssessment(basis, { tenor: 5 }), ten = bankAssessment(basis, { tenor: 10 });
    expect(five.principal12m).toBe(900000 / BANK_LIMITS.existingLoanYears);
    expect(ten.principal12m).toBe(five.principal12m);
    expect(ten.ratios.find((r) => r.key === "dscr")!.value).toBe(five.ratios.find((r) => r.key === "dscr")!.value);
    // The tenor still sizes a new loan.
    expect(ten.capacity.byDscr!).toBeGreaterThan(0);
  });

  it("a schedule the user enters wins", () => {
    const a = bankAssessment(basis, { principal12m: 300000, accounts: loans });
    expect(a.principalSource).toBe("entered");
    expect(a.ratios.find((r) => r.key === "dscr")!.value).toBeCloseTo(1718750 / 750000, 9);
  });
});

describe("bank: every measure, by hand", () => {
  const a = bankAssessment(basis, { principal12m: 300000 });
  const r = (k: string) => a.ratios.find((x) => x.key === k)!;
  it.each([
    ["quick", (600000 + 3200000) / 3131250, "strong"],
    ["current", 5600000 / 3131250, "strong"],
    ["gearing", 2300000 / 4068750, "strong"],
    ["liab_tnw", 4031250 / 4068750, "strong"],
    ["equity_ratio", (4068750 / 8100000) * 100, "strong"],
    ["ebitda_margin", (2000000 / 12000000) * 100, "strong"],
    ["net_debt_ebitda", (2300000 - 600000) / 2000000, "strong"],
    ["debt_ebitda", 2300000 / 2000000, "strong"],
    ["lt_funding", 4068750 + 900000 - 2500000, "strong"],
    ["dio", (1600000 / 8000000) * 365, "strong"],
    ["dso", (2700000 / 1.14 / 12000000) * 365, "watch"], // receivables net of 14% VAT
    ["dpo", (1450000 / 1.14 / 8000000) * 365, "info"],
    ["ccc", (2700000 / 1.14 / 12000000) * 365 + (1600000 / 8000000) * 365 - (1450000 / 1.14 / 8000000) * 365, "info"],
    ["rev_growth", (12000000 / 9500000 - 1) * 100, "strong"],
    ["int_cover", 1700000 / 450000, "strong"],
  ] as const)("%s", (key, value, band) => {
    expect(r(key).value).toBeCloseTo(value, 6);
    expect(r(key).band).toBe(band);
  });

  it("no borrowing and no operating profit is not rated strong", () => {
    const b = twelveMonths([{ period: "2025-12", pl: { revenue: 100, exp_fixed: 150 }, bs: { cash: 50, other_equity: 50 } }], "2025-12");
    const x = bankAssessment(b).ratios.find((k) => k.key === "debt_ebitda")!;
    expect(x.value).toBeNull();
    expect(x.band).toBe("info");
  });

  it("stress bands use the same lender limits", () => {
    const s = stressTest(basis, a, { taxRate: 0.225 });
    const base = s.scenarios.find((x) => x.key === "base")!;
    expect(base.dscr).toBeCloseTo(1718750 / 750000, 9);
    expect(base.band).toBe(base.dscr! >= BANK_LIMITS.dscr ? "pass" : base.dscr! >= BANK_LIMITS.dscrFloor ? "tight" : "fail");
  });
});

describe("bank: questions the bank will ask", () => {
  const flags = (m: MonthData[], inp = {}) => bankAssessment(twelveMonths(m, "2025-12"), inp).flags.map((f) => f.key);

  it("negative equity and a loss", () => {
    const f = flags(with2025({ exp_fixed: 6000000, tax_expenses: 0 }, { retained_earnings: -2500000, other_equity: 500000 }));
    expect(f).toContain("neg_equity");
    expect(f).toContain("loss");
  });
  it("large other current assets", () => expect(flags(with2025({}, { other_ca: 2000000, other_equity: 4000000 }))).toContain("other_ca"));
  it("high cash beside borrowing", () => expect(flags(with2025({}, { cash: 1500000, other_equity: 2900000 }))).toContain("cash_and_debt"));
  it("taxes payable building up", () => expect(flags(with2025({}, { tax_liab: 500000, other_equity: 1781250 }))).toContain("tax_build"));
  it("distributions while debt is high", () => expect(flags(with2025({ dividends: 100000, exp_fixed: 3500000 }, {}))).toContain("dividends"));
  it("an unbalanced balance sheet", () => expect(flags(with2025({}, { cash: 700000 }))).toContain("imbalance"));
  it("stock growth is measured against cost of sales before depreciation, as stock days are", () => {
    // Goods bought are flat at 6.5m while stock grew 28.6%; cost of sales including 3m of depreciation would read +46% and hide it.
    expect(flags(with2025({ cos_variable: 6500000, cos_depreciation: 3000000 }, {}))).toContain("inv_growth");
    expect(flags(with2025({ cos_variable: 9000000 }, {}))).not.toContain("inv_growth");
  });
  it("fewer than twelve months", () => {
    const m: MonthData[] = Array.from({ length: 6 }, (_, i) => ({ period: addMonths("2025-07", i), pl: { revenue: 100, exp_fixed: 50 }, bs: { cash: 50 * (i + 1), other_equity: 50 * (i + 1) } }));
    expect(bankAssessment(twelveMonths(m, "2025-12")).flags.map((f) => f.key)).toContain("coverage");
  });
});

describe("KPIs and findings", () => {
  it("gross margin return on stock uses average month-end stock, like stock days", () => {
    const P = plCalc({ revenue: 1000, cos_variable: 600 });
    const B = bsCalc({ inventory: 300, cash: 0 }), B0 = bsCalc({ inventory: 100 });
    const k = computeKpis({ P, B, B0, Bavg: bsCalc({ inventory: 200 }), Pprev: null, days: 31, ocf: null });
    expect(k.gmroi).toBeCloseTo(((400 * 365) / 31 / 200) * 100, 9);
  });

  it("operating leverage is contribution over operating profit", () => {
    const P = plCalc({ revenue: 100, cos_variable: 60, exp_fixed: 30, other_income: 20 });
    const f = insights({ P, B: bsCalc({ cash: 10, other_equity: 10 }), Pprev: null, K: {}, W: null, tg: {}, Ps: [P], Bs: [], days: 30, status: {}, cur: "EGP" });
    expect(f.find((x) => x.title.startsWith("High operating leverage"))?.title).toBe("High operating leverage (4.0x)");
  });

  it("cash burn is the fall over the real gap in months", () => {
    const P = plCalc({ revenue: 100, cos_variable: 50, exp_fixed: 40 });
    const Bs = [100, 90, 50, 45].map((cash) => bsCalc({ cash, other_equity: cash }));
    const W = { ocf: 1, fcf: 1, ncf: -5 } as never;
    const f = insights({ P, B: Bs[3], Pprev: null, K: {}, W, tg: {}, Ps: [P], Bs, periods: ["2025-01", "2025-02", "2025-04", "2025-05"], days: 31, status: {}, cur: "EGP" });
    // 100 → 45 between Jan and May is 4 months, gap included: 13.75 a month, 3.3 months of cash.
    expect(f.find((x) => x.title.startsWith("Net cash outflow"))?.title).toContain("3.3 months");
  });
});

describe("the twelve-month basis adds up its months", () => {
  const months = sample.months as MonthData[];
  const sorted = [...months].sort((a, b) => a.period.localeCompare(b.period));
  for (let i = 12; i < sorted.length; i++) {
    const end = sorted[i].period;
    it(end, () => {
      const b = twelveMonths(months, end);
      const window = sorted.slice(i - 11, i + 1);
      expect(b.P.revenue).toBeCloseTo(window.reduce((s, m) => s + (m.pl.revenue ?? 0), 0), 6);
      // Operating cash flow over the year equals the sum of the monthly figures (working-capital changes telescope).
      const monthly = window.reduce((s, m, j) => s + cashFlowStatement(plCalc(m.pl), bsCalc(m.bs), bsCalc((j ? window[j - 1] : sorted[i - 12]).bs)).cfo, 0);
      expect(b.ocf!).toBeCloseTo(monthly, 4);
    });
  }
});

describe("forecast tax carries the year to date", () => {
  it("a loss in the actual months of the year is offset before tax is charged", () => {
    const hist: MonthData[] = Array.from({ length: 18 }, (_, i) => {
      const p = addMonths("2024-01", i);
      const loss = p >= "2025-01";
      return { period: p, pl: { revenue: 100000, cos_variable: 40000, exp_fixed: loss ? 80000 : 20000 }, bs: { cash: 100000, other_equity: 100000 } };
    });
    const S = { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 };
    const f = forecast(hist, S, { revenueGrowth: 400, horizon: 12 });
    if (!f.ok) throw new Error(f.reason);
    const histYtd = hist.filter((m) => m.period >= fyStartOf("2025-06", 1)).reduce((s, m) => s + plCalc(m.pl).ebt, 0);
    expect(histYtd).toBeLessThan(0);
    let ytd = histYtd, taxed = 0;
    for (const m of f.months.filter((x) => x.period <= "2025-12")) {
      ytd += m.P.ebt; taxed += m.P.tax_expenses;
      expect(taxed).toBeCloseTo(Math.max(0, ytd * 0.225), 6);
    }
  });
});

describe("display and saved text", () => {
  it("short amounts never read 1000K", () => {
    expect(money(999600, "EGP", true)).toBe("EGP 1.0M");
    expect(money(999400, "EGP", true)).toBe("EGP 999K");
    expect(money(999.7, "EGP", true)).toBe("EGP 1K");
  });

  it("an AI memo knows the inputs it was written for", () => {
    const a = { requestAmount: 1000000, rate: 25 };
    const body = stampMemo("Headline\n• point", "bank", a);
    expect(readMemo(body, "bank", a)).toEqual({ text: "Headline\n• point", stale: false });
    expect(readMemo(body, "bank", { ...a, requestAmount: 2000000 }).stale).toBe(true);
    // A rate it does not use does not make it stale; a typed memo never goes stale.
    expect(readMemo(body, "bank", { ...a, fxEnd: 50 }).stale).toBe(false);
    expect(readMemo("typed by hand", "bank", { rate: 30 }).stale).toBe(false);
    expect(stripMemoStamp(body)).toBe("Headline\n• point");
  });

  it("the company export lists forecast drivers apart from KPIs", () => {
    const sheets = companySheets({
      exportedAt: "2026-10-13", orgName: "Org",
      company: { name: "Co", currency: "EGP", fy_start_month: 1, tax_rate: 0.225, industry: null, source: "upload", data_version: 1, last_synced_at: null, ai_context: {}, notes: null,
        kpi_config: { gpm: { active: true, target: 35 }, economy: { rate: 25 }, forecast: { horizon: 12 } } },
      accounts: [], imports: [], commentary: [], reports: [],
    } as never);
    const rows = sheets[0].rows.map((r) => r[0]);
    expect(rows).toContain("Forecast drivers");
    const kpiStart = rows.indexOf("KPI");
    expect(rows.slice(kpiStart + 1)).not.toContain("forecast");
    expect(rows.slice(kpiStart + 1)).not.toContain("economy");
  });
});

describe("balances on the wrong side", () => {
  it("customer and supplier days are n/a, not negative, when the balance is in credit or debit", () => {
    const P = plCalc({ revenue: 1000, cos_variable: 600 });
    const B = bsCalc({ ar: -50, ap: -20, inventory: 100, cash: 30 });
    const k = computeKpis({ P, B, B0: null, Pprev: null, days: 30, ocf: null });
    expect(k.ar_days).toBeNull();
    expect(k.ap_days).toBeNull();
    expect(k.ccc).toBeNull();
    expect(k.inv_days).toBeCloseTo(5, 9);
  });

  it("the bank view says why customer days are missing", () => {
    const a = bankAssessment(twelveMonths(with2025({}, { ar: -400000, other_cl: -3600000 }), "2025-12"));
    const dso = a.ratios.find((r) => r.key === "dso")!;
    // Average receivables (2.2m + −0.4m) ÷ 2 are positive, so the days are still measured here …
    expect(dso.value).toBeCloseTo((900000 / 1.14 / 12000000) * 365, 6);
    // … and with both month-ends in credit they are not.
    const b = bankAssessment(twelveMonths([{ ...annual[0], bs: { ...annual[0].bs, ar: -100, other_cl: -2200100 } }, with2025({}, { ar: -400000, other_cl: -3600000 })[1]], "2025-12"));
    expect(b.ratios.find((r) => r.key === "dso")!.value).toBeNull();
    expect(b.ratios.find((r) => r.key === "dso")!.banker).toContain("cannot be measured");
  });

  it("the data check names the accounts and the fix", async () => {
    const { runChecks } = await import("@/lib/company/checks");
    const accounts = [
      { name: "Trade Receivables", cls: "ar" as const, amounts: { "2026-09": -400000 } },
      { name: "Advance from Customers", cls: "other_cl" as const, amounts: { "2026-09": -3000000 } },
      { name: "Bank", cls: "cash" as const, amounts: { "2026-09": 10000000 } },
      { name: "Capital", cls: "other_equity" as const, amounts: { "2026-09": 6600000 } },
    ];
    const c = runChecks({ accounts }).filter((x) => x.id === "contra_balance");
    expect(c.map((x) => x.title)).toEqual(["Accounts Receivable on the wrong side", "Other Current Liabilities on the wrong side"]);
    expect(c[0].detail).toContain("Trade Receivables: credit 400,000");
    expect(c[0].detail).toContain("Advance from Customers: debit 3,000,000");
    expect(c[0].detail).toContain("change its class to Accounts Receivable");
  });
});
