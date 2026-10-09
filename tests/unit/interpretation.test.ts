import { describe, expect, it } from "vitest";
import { runChecks } from "@/lib/company/checks";
import { planImport, unresolved, type IncomingAccount } from "@/lib/company/import-plan";
import { ingest, toAccountInputs, type IngestOptions, type IngestResult } from "@/lib/ingest/pipeline";
import type { Grid } from "@/lib/ingest/extract";
import { generalLedger, journalItems, months, odooReports, trialBalanceDebitCredit, trialBalanceSigned, trialBalanceSinglePeriod } from "../fixtures/odoo";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {} };
const accts = (res: IngestResult) => toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) }));
const blocking = (res: IngestResult) => runChecks({ accounts: accts(res), controls: res.controls, extra: res.checks }).filter((c) => c.severity === "block");
const plan = (res: IngestResult, current: Parameters<typeof planImport>[0] = []) =>
  planImport(current, toAccountInputs(res) as IncomingAccount[], { mode: "merge", slices: res.slices, controls: res.controls, extra: res.checks, ranges: res.ranges });

describe("every supported Odoo export passes the accounting checks", () => {
  const cases: [string, Grid[]][] = [
    ["P&L + balance sheet", odooReports()], ["year-to-date P&L", odooReports({ ytd: true })], ["unclosed earnings", odooReports({ unclosed: true })],
    ["signed trial balance", trialBalanceSigned()], ["debit/credit trial balance", trialBalanceDebitCredit()], ["journal items", journalItems()], ["general ledger", generalLedger()],
  ];
  for (const [name, g] of cases) it(name, () => expect(blocking(ingest(g, OPTS))).toEqual([]));

  it("reads the file's Net Profit row as a control total and catches a wrong mapping", () => {
    const res = ingest(odooReports(), OPTS);
    expect(res.controls.filter((c) => c.metric === "net_income")).toHaveLength(months.length);
    // map a cost of sales account as revenue: net profit no longer matches the file
    const cos = res.lines.find((l) => l.cls === "cos_variable")!;
    const bad = ingest(odooReports(), { ...OPTS, mapping: { [cos.key]: "revenue" } });
    const ct = blocking(bad).filter((c) => c.id === "control_total");
    expect(ct.length).toBeGreaterThan(0);
    expect(ct[0].title).toBe("Net profit does not match the file");
  });
});

describe("how the file was read", () => {
  it("ignores a total row that is zero in every month (a placeholder, not a figure)", () => {
    const g = odooReports();
    const row = g[0].rows.find((r) => r[0] === "Net Profit")!;
    for (let i = 1; i < row.length; i++) row[i] = 0;
    const res = ingest(g, OPTS);
    expect(res.controls.filter((c) => c.metric === "net_income")).toEqual([]);
    expect(blocking(res)).toEqual([]);
  });

  it("reports each sheet's layout and period columns", () => {
    const res = ingest(odooReports(), OPTS);
    expect(res.layouts.map((l) => [l.sheet, l.kind, l.columns.filter((c) => c.used).length])).toEqual([
      ["Profit and Loss", "columns", months.length], ["Balance Sheet", "columns", months.length],
    ]);
  });

  it("a sheet can be left out and a column re-dated or dropped", () => {
    const g = odooReports();
    const pl = ingest(g, OPTS, { "Balance Sheet": { skip: true } });
    expect(pl.slices.BS).toEqual([]);
    expect(pl.layouts[1].kind).toBe("skipped");
    const lastCol = pl.layouts[0].columns[pl.layouts[0].columns.length - 1].col;
    const dropped = ingest(g, OPTS, { "Profit and Loss": { periods: { [lastCol]: null } } });
    expect(dropped.slices.PL).toEqual(months.slice(0, -1).map((m) => m.period));
    const moved = ingest(g, OPTS, { "Profit and Loss": { periods: { [lastCol]: "2030-01" } }, "Balance Sheet": { skip: true } });
    expect(moved.slices.PL).toContain("2030-01");
  });

  it("amounts in thousands are scaled, and the user can override the units", () => {
    const g = odooReports();
    const base = ingest(g, OPTS);
    g[0].rows[1] = ["Amounts in thousands (EGP '000)"];
    for (const r of g[0].rows.slice(3)) for (let i = 1; i < r.length; i++) if (typeof r[i] === "number") r[i] = (r[i] as number) / 1000;
    const res = ingest([g[0]], OPTS);
    expect(res.layouts[0].scale).toBe(1000);
    const p = months[0].period;
    expect(Math.round(res.totals.revenue[p])).toBe(Math.round(base.totals.revenue[p]));
    const raw = ingest([g[0]], OPTS, { "Profit and Loss": { scale: 1 } });
    expect(Math.round(raw.totals.revenue[p])).toBe(Math.round(base.totals.revenue[p] / 1000));
  });

  it("comma-decimal text amounts are read correctly", () => {
    const g: Grid[] = [{ name: "Profit and Loss", rows: [["", "Jan 2025", "Feb 2025"], ["400000 Sales", "1.234.567,50", "2.000,00"], ["600000 Rent", "1.000,25", "1.000,25"]] }];
    const res = ingest(g, OPTS);
    expect(res.layouts[0].decimal).toBe(",");
    expect(res.totals.revenue["2025-01"]).toBeCloseTo(1234567.5);
  });

  it("the same accounts in two sheets are flagged as double counting", () => {
    const g = [...odooReports(), ...trialBalanceSigned()];
    const dup = blocking(ingest(g, OPTS)).filter((c) => c.id === "duplicate");
    expect(dup.length).toBeGreaterThan(0);
    expect(dup[0].detail).toMatch(/counted twice/);
  });

  it("debits that do not equal credits block the import", () => {
    const g = trialBalanceDebitCredit();
    const row = g[0].rows.findIndex((r) => typeof r[0] === "string" && /^\d{6} /.test(r[0] as string) && typeof r[3] === "number" && (r[3] as number) > 0);
    g[0].rows.splice(row, 1); // one account missing from the export
    expect(blocking(ingest(g, OPTS)).map((c) => c.id)).toContain("tb_zero");
  });
});

describe("columns covering several months", () => {
  it("a year-to-date column becomes its last month using the months already loaded", () => {
    // load Jan..(n-1) monthly first, then a single 'From 01/01 to end' column for month n
    const all = ingest(odooReports(), OPTS);
    const n = months.findIndex((m) => m.period === "2026-04"), end = months[n].period, [y] = end.split("-");
    const firstYear = months.filter((m) => m.period.startsWith(y) && m.period < end).map((m) => m.period);
    const stored = plan(all).accounts.map((a) => ({ ...a, amounts: Object.fromEntries(Object.entries(a.amounts).filter(([p]) => p < end)), sources: {} }));
    // Build a one-column YTD P&L from the monthly fixture
    const g = odooReports({ ytd: true });
    const pl = g[0];
    const col = 1 + months.findIndex((m) => m.period === end);
    pl.rows = pl.rows.map((r, i) => (i === 2 ? ["", `From 01/01/${y} to 28/${end.slice(5)}/${y}`] : [r[0], r[col]]));
    const res = ingest([pl], OPTS);
    expect(res.ranges).toEqual({ [end]: firstYear.length + 1 });
    const p = plan(res, stored);
    expect(unresolved(p.checks, [])).toEqual([]);
    const rev = (accts: { cls: string; amounts: Record<string, number> }[]) => accts.filter((a) => a.cls === "revenue").reduce((s, a) => s + (a.amounts[end] ?? 0), 0);
    expect(Math.round(rev(p.accounts))).toBe(Math.round((months[n].pl as Record<string, number>).revenue));
  });

  it("without the earlier months it blocks instead of storing the range as one month", () => {
    const g = trialBalanceSinglePeriod(3);
    const [y, m] = months[3].period.split("-");
    g[0].rows[2][3] = `From 01/01/${y} to 30/${m}/${y}`;
    const res = ingest(g, OPTS);
    const p = plan(res);
    const mm = unresolved(p.checks, []).filter((c) => c.id === "multi_month");
    expect(mm).toHaveLength(1);
    expect(mm[0].period).toBe(months[3].period);
  });
});
