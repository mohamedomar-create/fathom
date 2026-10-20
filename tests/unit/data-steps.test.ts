// The Data section's sequence: setup, opening balances, General Ledger (record), Trial Balance (verification only),
// sub-ledgers (sales detail, stock, receivables and payables, each reconciled to its control account), then review.
type A = { code: string; name: string; cls: string; amounts: Record<string, number> };
import { describe, expect, it } from "vitest";
import { dataSteps, type DataStatus } from "@/lib/company/data-steps";

const empty: DataStatus = {
  basePath: "/company/x", booksStart: null, opening: null, booksFromZero: false, openingInLedger: false,
  ledger: null, tb: null, sales: null, stock: null, ageing: [], openChecks: 0,
};
const ids = (s: DataStatus) => dataSteps(s).map((x) => `${x.id}:${x.status}`);

describe("data steps", () => {
  it("a new company: setup first, the ledger is the first upload, and everything after it waits for it", () => {
    expect(ids(empty)).toEqual(["setup:todo", "opening:todo", "ledger:todo", "tb:locked", "sales:locked", "stock:locked", "ageing:locked", "review:locked"]);
    const gl = dataSteps(empty).find((s) => s.id === "ledger")!;
    expect(gl.action?.href).toBe("/company/x/data/upload?step=financials");
    expect(gl.file).toMatch(/Accounting → Reporting → General Ledger/);
  });

  it("the ledger loaded and tied: the Trial Balance and sub-ledgers open; opening balances carried by the ledger count as done", () => {
    const s: DataStatus = { ...empty, booksStart: "2021-07-01", openingInLedger: true, ledger: { from: "2021-07", to: "2026-10", odoo: false, issues: 0 } };
    expect(ids(s)).toEqual(["setup:done", "opening:done", "ledger:verified", "tb:todo", "sales:todo", "stock:todo", "ageing:todo", "review:todo"]);
    expect(dataSteps(s).find((x) => x.id === "ledger")!.detail).toMatch(/Jul 2021 – Oct 2026/);
  });

  it("a Trial Balance that differs from the books shows its differences; one that agrees is verified", () => {
    const base: DataStatus = { ...empty, booksStart: "2021-07-01", openingInLedger: true, ledger: { from: "2021-07", to: "2026-10", odoo: false, issues: 0 } };
    expect(dataSteps({ ...base, tb: { at: "2026-10-19", file: "tb.xlsx", months: ["2026-09"], diffs: 3 } }).find((x) => x.id === "tb")).toMatchObject({ status: "issues", detail: expect.stringMatching(/3 differences/) });
    expect(dataSteps({ ...base, tb: { at: "2026-10-19", file: "tb.xlsx", months: ["2026-09"], diffs: 0 } }).find((x) => x.id === "tb")!.status).toBe("verified");
  });

  it("sub-ledgers are verified only when they tie to their control accounts", () => {
    const base: DataStatus = { ...empty, booksStart: "2021-07-01", openingInLedger: true, ledger: { from: "2021-07", to: "2026-10", odoo: false, issues: 0 } };
    const s: DataStatus = { ...base, sales: { months: ["2026-08", "2026-09"], untied: ["2026-09"] }, stock: { checked: 4, ok: 4 }, ageing: [{ side: "receivable", asOf: "2026-10-15", status: "ok" }, { side: "payable", asOf: "2026-10-15", status: "off" }] };
    expect(ids(s).slice(4, 7)).toEqual(["sales:issues", "stock:verified", "ageing:issues"]);
  });

  it("review is done only when nothing is open", () => {
    const s: DataStatus = { ...empty, booksStart: "2021-07-01", openingInLedger: true, ledger: { from: "2021-07", to: "2026-10", odoo: false, issues: 0 }, tb: { at: "x", file: "tb", months: ["2026-09"], diffs: 0 } };
    expect(dataSteps({ ...s, openChecks: 2 }).find((x) => x.id === "review")).toMatchObject({ status: "issues", detail: expect.stringMatching(/2 checks/) });
    expect(dataSteps(s).find((x) => x.id === "review")!.status).toBe("verified");
  });

  it("a sub-ledger loaded before the General Ledger is shown as loaded, not checked, never as locked", () => {
    const st = dataSteps({ ...empty, ageing: [{ side: "payable", asOf: "2026-09-30", status: "no_books" }] }).find((x) => x.id === "ageing")!;
    expect(st.status).toBe("done");
    expect(st.detail).toMatch(/not checked yet: load the General Ledger/i);
    expect(st.action).not.toBeNull();
  });

  it("books that start from zero need no opening balances", () => {
    expect(dataSteps({ ...empty, booksFromZero: true }).find((x) => x.id === "opening")!.status).toBe("done");
  });
});

describe("Trial Balance against the books", () => {
  it("compares every account every month by code, names the differences, and never needs a save", async () => {
    const { compareTrialBalance } = await import("@/lib/company/compare");
    const books: A[] = [
      { code: "121221", name: "CIB Bank", cls: "cash", amounts: { "2026-08": 1000, "2026-09": 1200 } },
      { code: "410000", name: "Revenues", cls: "revenue", amounts: { "2026-09": 500 } },
      { code: "211100", name: "Suppliers", cls: "ap", amounts: { "2026-09": 300 } },
    ];
    const tb: A[] = [
      { code: "121221", name: "CIB Bank EGP", cls: "cash", amounts: { "2026-09": 1200 } },
      { code: "410000", name: "Revenues", cls: "revenue", amounts: { "2026-09": 450 } },
      { code: "999999", name: "Suspense", cls: "other_cl", amounts: { "2026-09": 20 } },
    ];
    const r = compareTrialBalance(tb, books);
    expect(r.months).toEqual(["2026-09"]);
    expect(r.diffs).toEqual([
      { period: "2026-09", account: "211100 Suppliers", books: 300, file: 0, diff: 300 },
      { period: "2026-09", account: "410000 Revenues", books: 500, file: 450, diff: 50 },
      { period: "2026-09", account: "999999 Suspense", books: 0, file: 20, diff: -20 },
    ]);
  });

  it("rounding of 1 or less is not a difference; accounts with no code are matched by name", async () => {
    const { compareTrialBalance } = await import("@/lib/company/compare");
    const r = compareTrialBalance([{ code: "", name: "Petty cash", cls: "cash", amounts: { "2026-09": 100.6 } }], [{ code: "", name: "petty cash", cls: "cash", amounts: { "2026-09": 100 } }]);
    expect(r.diffs).toEqual([]);
  });
});

describe("Trial Balance months the file only half covers", () => {
  it("a month with only balances in the file (its opening column) compares the balance sheet only", async () => {
    const { compareTrialBalance } = await import("@/lib/company/compare");
    const books: A[] = [{ code: "121221", name: "Bank", cls: "cash", amounts: { "2026-08": 1000, "2026-09": 1200 } }, { code: "410000", name: "Revenues", cls: "revenue", amounts: { "2026-08": 900, "2026-09": 500 } }];
    const tb: A[] = [{ code: "121221", name: "Bank", cls: "cash", amounts: { "2026-08": 1000, "2026-09": 1200 } }, { code: "410000", name: "Revenues", cls: "revenue", amounts: { "2026-09": 500 } }];
    expect(compareTrialBalance(tb, books).diffs).toEqual([]);
  });
});

describe("Trial Balance equity", () => {
  it("retained earnings and other equity are compared in total: Odoo's undistributed profits and the books' computed earnings are one figure", async () => {
    const { compareTrialBalance } = await import("@/lib/company/compare");
    const books: A[] = [{ code: "", name: "Earnings to date (computed from P&L accounts)", cls: "retained_earnings", amounts: { "2026-09": 1000 } }];
    const tb: A[] = [{ code: "99999", name: "Undistributed Profits/Losses", cls: "retained_earnings", amounts: { "2026-09": 800 } }, { code: "", name: "z Adjustment", cls: "other_equity", amounts: { "2026-09": 200 } }];
    expect(compareTrialBalance(tb, books).diffs).toEqual([]);
    const off = compareTrialBalance([{ ...tb[0], amounts: { "2026-09": 700 } }, tb[1]], books).diffs;
    expect(off).toEqual([{ period: "2026-09", account: "Equity: retained earnings and other equity (in total)", books: 1000, file: 900, diff: 100 }]);
  });
});

describe("Trial Balance columns that cover several months", () => {
  it("a year-to-date P&L column is compared with the books' months added up; balances stay at the month end", async () => {
    const { compareTrialBalance } = await import("@/lib/company/compare");
    const books: A[] = [
      { code: "410000", name: "Revenues", cls: "revenue", amounts: { "2026-08": 100, "2026-09": 200, "2026-10": 300 } },
      { code: "121221", name: "CIB Bank", cls: "cash", amounts: { "2026-10": 900 } },
    ];
    const tb: A[] = [
      { code: "410000", name: "Revenues", cls: "revenue", amounts: { "2026-10": 600 } },
      { code: "121221", name: "CIB Bank", cls: "cash", amounts: { "2026-10": 900 } },
    ];
    expect(compareTrialBalance(tb, books, { "2026-10": 3 }).diffs).toEqual([]);
    expect(compareTrialBalance(tb, books).diffs).toEqual([{ period: "2026-10", account: "410000 Revenues", books: 300, file: 600, diff: -300 }]);
  });
  it("a sub-ledger whose figures could not be read says so, never 'to do' or 'upload'", () => {
    const base: DataStatus = { ...empty, booksStart: "2021-07-01", openingInLedger: true, ledger: { from: "2021-07", to: "2026-10", odoo: false, issues: 0 }, unread: ["sales", "ageing"] };
    const st = Object.fromEntries(dataSteps(base).map((x) => [x.id, x]));
    expect(st.sales.status).toBe("unchecked");
    expect(st.sales.detail).toMatch(/couldn't be read/);
    expect(st.ageing.status).toBe("unchecked");
    expect(st.stock.status).toBe("todo");
  });
});
