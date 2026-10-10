import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import { analyze, BS_KEYS, PL_KEYS } from "@/lib/engine";
import { buildMonths } from "@/lib/company/build";
import { ingest, toAccountInputs, type IngestOptions, type IngestResult } from "@/lib/ingest/pipeline";
import { cleanNum, parsePeriod, parsePeriodRange, splitCode, type Cell } from "@/lib/ingest/parse";
import type { Grid } from "@/lib/ingest/extract";
import { classify } from "@/lib/ingest/classify";
import { readWorkbook } from "@/lib/ingest/read";
import { generalLedger, journalItems, months, odooReports, trialBalanceDebitCredit, trialBalanceSigned, trialBalanceSinglePeriod } from "../fixtures/odoo";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {} };

function classTotals(res: IngestResult) {
  const accts = toAccountInputs(res).map((a, i) => ({ id: String(i), ...a }));
  return buildMonths(accts);
}

function expectMatchesSample(res: IngestResult, from = 0) {
  const got = classTotals(res);
  const want = months.slice(from);
  expect(got.map((m) => m.period)).toEqual(want.map((m) => m.period));
  for (const w of want) {
    const g = got.find((x) => x.period === w.period)!;
    for (const k of PL_KEYS) expect(Math.round(g.pl[k] ?? 0), `${w.period} ${k}`).toBe(Math.round((w.pl as Record<string, number>)[k] ?? 0));
    for (const k of BS_KEYS) expect(Math.round(g.bs[k] ?? 0), `${w.period} ${k}`).toBe(Math.round((w.bs as Record<string, number>)[k] ?? 0));
  }
  for (const v of Object.values(res.imbalance)) expect(Math.abs(v)).toBeLessThan(1);
}

describe("parsing helpers", () => {
  it("cleans numbers in every common format", () => {
    expect(cleanNum("(1,234.50)")).toBe(-1234.5);
    expect(cleanNum("1.234,50-")).toBe(-1234.5);
    expect(cleanNum("١٬٢٣٤٫٥")).toBe(1234.5);
    expect(cleanNum("-")).toBe(0);
    expect(cleanNum("EGP 12,000")).toBe(12000);
    expect(cleanNum("Total")).toBeNull();
  });
  it("parses period headers", () => {
    expect(parsePeriod("Jan 2026")).toBe("2026-01");
    expect(parsePeriod("2026-03")).toBe("2026-03");
    expect(parsePeriod("31/01/2026")).toBe("2026-01");
    expect(parsePeriod("Sep-25")).toBe("2025-09");
    expect(parsePeriod("مارس 2026")).toBe("2026-03");
    expect(parsePeriod(new Date(2026, 4, 31))).toBe("2026-05");
    expect(parsePeriod("Budget")).toBeNull();
  });
  it("splits Odoo account codes", () => {
    expect(splitCode("400100 Product Sales")).toEqual({ code: "400100", name: "Product Sales" });
    expect(splitCode("Bank")).toEqual({ code: "", name: "Bank" });
  });
  it("classifies English and Arabic labels", () => {
    expect(classify("مبيعات", "", "PL").cls).toBe("revenue");
    expect(classify("رواتب وأجور", "المصروفات", "PL").cls).toBe("exp_fixed");
    expect(classify("عملاء", "", "BS").cls).toBe("ar");
    expect(classify("ضريبة القيمة المضافة المستحقة", "", "BS").cls).toBe("tax_liab");
    expect(classify("Bank Overdraft", "", "BS").cls).toBe("std");
    expect(classify("Accumulated Depreciation - Vehicles", "Fixed Assets", "BS").cls).toBe("fixed_assets");
    expect(classify("Sales Returns", "Income", "PL").cls).toBe("revenue");
  });
});

describe("Odoo exports reproduce the source numbers", () => {
  it("P&L + Balance Sheet reports with monthly columns (headings, subtotals, Arabic heading)", () => {
    const res = ingest(odooReports({ arabicHeadings: true }), OPTS);
    expect(res.kind).toBe("natural");
    expect(res.issues.subtotals.length).toBeGreaterThan(0);
    expect(res.lines.filter((l) => !l.cls && !l.excluded)).toHaveLength(0);
    expectMatchesSample(res);
  });

  it("year-to-date P&L columns are detected and converted to months", () => {
    const res = ingest(odooReports({ ytd: true }), OPTS);
    expect(res.detected.ytd).toBe(true);
    expectMatchesSample(res);
  });

  it("unclosed current-year earnings are detected and closed", () => {
    const res = ingest(odooReports({ unclosed: true }), OPTS);
    expect(res.detected.unclosedEarnings).toBe(true);
    expect(res.lines.some((l) => l.key === "__close_earnings")).toBe(true);
    for (const v of Object.values(res.imbalance)) expect(Math.abs(v)).toBeLessThan(1);
    const off = ingest(odooReports({ unclosed: true }), { ...OPTS, closeEarnings: false });
    expect(off.issues.warnings.join(" ")).toMatch(/unclosed/);
  });

  it("trial balance with negative credits is flipped", () => {
    const res = ingest(trialBalanceSigned(), OPTS);
    expect(res.detected.creditNegative).toBe(true);
    expectMatchesSample(res);
  });

  it("journal items (Account / Date / Debit / Credit) build balances and retained earnings", () => {
    const res = ingest(journalItems(), OPTS);
    expect(res.kind).toBe("movement");
    expect(res.lines.some((l) => l.key === "__re_computed")).toBe(true);
    expectMatchesSample(res);
  });

  it("Odoo Trial Balance with Debit/Credit per month and Initial Balance", () => {
    const res = ingest(trialBalanceDebitCredit(), OPTS);
    expect(res.kind).toBe("movement");
    expectMatchesSample(res, 1);
  });

  it("Odoo General Ledger (account headings, Initial Balance rows, dated move lines)", () => {
    const res = ingest(generalLedger(), OPTS);
    expect(res.kind).toBe("movement");
    expect(res.lines.some((l) => /^total$/i.test(l.name) && !l.excluded)).toBe(false);
    expectMatchesSample(res, 1);
  });

  it("Odoo Trial Balance for one month (date-range header, no comparison)", () => {
    const res = ingest(trialBalanceSinglePeriod(3), OPTS);
    expect(res.periods).toEqual([months[3].period]);
    expect(res.issues.warnings.some((w) => /covers/.test(w))).toBe(false);
    const got = classTotals(res)[0];
    const want = months[3];
    for (const k of PL_KEYS) expect(Math.round(got.pl[k] ?? 0), k).toBe(Math.round((want.pl as Record<string, number>)[k] ?? 0));
    for (const k of BS_KEYS) expect(Math.round(got.bs[k] ?? 0), k).toBe(Math.round((want.bs as Record<string, number>)[k] ?? 0));
  });

  it("a multi-month date-range column is flagged as a range, never silently stored as one month", () => {
    const g = trialBalanceSinglePeriod(3);
    const [y, m] = months[3].period.split("-");
    g[0].rows[2][3] = `From 01/01/${y} to 30/${m}/${y}`;
    const res = ingest(g, OPTS);
    expect(res.periods).toEqual([months[3].period]);
    expect(res.ranges).toEqual({ [months[3].period]: Number(m) });
    expect(res.issues.notes.some((w) => /cover several months/.test(w))).toBe(true);
  });

  it("an unrecognised sheet explains which Odoo exports work", () => {
    const res = ingest([{ name: "Notes", rows: [["Hello"], ["world"]] }], OPTS);
    expect(res.issues.warnings[0]).toMatch(/General Ledger/);
  });

  it("user mapping overrides and exclusions are respected", () => {
    const base = ingest(odooReports(), OPTS);
    const line = base.lines.find((l) => l.name === "Marketing")!;
    const res = ingest(odooReports(), { ...OPTS, mapping: { [line.key]: "exp_variable" } });
    expect(res.lines.find((l) => l.key === line.key)!.cls).toBe("exp_variable");
    const ex = ingest(odooReports(), { ...OPTS, mapping: { [line.key]: "" } });
    expect(ex.lines.find((l) => l.key === line.key)!.excluded).toBe(true);
  });

  it("the full chain reads a real .xlsx and feeds the analysis engine", async () => {
    const wb = XLSX.utils.book_new();
    for (const g of odooReports()) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(g.rows), g.name);
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const grids = await readWorkbook(buf, "odoo.xlsx");
    const res = ingest(grids, OPTS);
    expectMatchesSample(res);
    const a = analyze(classTotals(res), { type: "month", end: "2026-09" }, { currency: "EGP", fyStartMonth: 1, taxRate: 0.225 });
    expect(Math.round(a.view.P.revenue)).toBe(1066138);
  });

  it("reads CSV exports", async () => {
    const csv = "Account,Date,Debit,Credit\n400100 Sales,2026-01-15,0,1000\n101100 Bank,2026-01-15,1000,0\n";
    const res = ingest(await readWorkbook(new TextEncoder().encode(csv).buffer as ArrayBuffer, "items.csv"), OPTS);
    const m = classTotals(res);
    expect(m[0].pl.revenue).toBe(1000);
    expect(m[0].bs.cash).toBe(1000);
    expect(Math.abs(res.imbalance["2026-01"])).toBeLessThan(0.01);
  });
});

describe("Odoo report column headers", () => {
  const now = new Date("2026-10-15T00:00:00");
  it.each([
    ["From 01/01/2025 to 09/30/2025", { end: "2025-09", months: 9 }],
    ["From 01/09/2025\nto 30/09/2025", { end: "2025-09", months: 1 }],
    ["09/01/2025 - 09/30/2025", { end: "2025-09", months: 1 }],
    ["2025-01-01 - 2025-03-31", { end: "2025-03", months: 3 }],
    ["Jan 2025 - Sep 2025", { end: "2025-09", months: 9 }],
    ["As of 09/30/2025", { end: "2025-09", months: 1 }],
    ["Q3 2025", { end: "2025-09", months: 3 }],
    ["H1 2025", { end: "2025-06", months: 6 }],
    ["2025", { end: "2025-12", months: 12 }],
    ["FY 2026", { end: "2026-10", months: 10 }],
  ])("%s", (label, want) => {
    expect(parsePeriodRange(label, now)).toMatchObject(want);
  });
  it("keeps the day a range ends on, so a part month is visible", () => {
    expect(parsePeriodRange("From 01/01/2026\nto  10/10/2026", now)).toEqual({ end: "2026-10", months: 10, endDay: "2026-10-10" });
    expect(parsePeriodRange("From 01/01/2025 to 09/30/2025", now)?.endDay).toBe("2025-09-30");
  });
  it("ignores text that is not a period", () => {
    for (const t of ["Balance", "Profit and Loss", "Total 2025 budget", "12/2025 notes"]) expect(parsePeriodRange(t, now)).toBeNull();
  });
  it("reads amounts exported as text with a currency", () => {
    expect(cleanNum("EGP -1,234.00")).toBe(-1234);
    expect(cleanNum("(1,234.50) ج.م")).toBe(-1234.5);
    expect(cleanNum("1.234,50 €")).toBe(1234.5);
    expect(cleanNum("−500")).toBe(-500);
  });

  const odooPL = (head: Cell[][]): Grid[] => [{ name: "Profit and Loss", rows: [
    ...head,
    ["Revenue", 1500], ["400000 Product Sales", 1000], ["400100 Services", 500],
    ["Less Costs of Revenue", 600], ["500000 Cost of Goods Sold", 600],
    ["Gross Profit", 900],
    ["Less Operating Expenses", 300], ["600000 Salaries", 200], ["610000 Rent", 100],
    ["Net Profit", 600],
  ] }];
  it("single-period P&L labelled with a range (Odoo default export)", () => {
    const res = ingest(odooPL([["My Company"], ["Profit and Loss"], ["", "From 09/01/2025 to 09/30/2025"], ["", "Balance"]]), OPTS);
    expect(res.periods).toEqual(["2025-09"]);
    expect(res.totals.revenue["2025-09"]).toBe(1500);
  });
  it("single-period P&L with a Balance column and the period in the title", () => {
    const res = ingest(odooPL([["Profit and Loss"], ["From 01/09/2025 to 30/09/2025"], ["", "Balance"]]), OPTS);
    expect(res.periods).toEqual(["2025-09"]);
    expect(res.totals.revenue["2025-09"]).toBe(1500);
  });
  it("year-labelled P&L is read as a 12-month range", () => {
    const res = ingest(odooPL([["Profit and Loss"], ["", "2025"]]), OPTS);
    expect(res.periods).toEqual(["2025-12"]);
    expect(res.ranges).toEqual({ "2025-12": 12 });
  });
});
