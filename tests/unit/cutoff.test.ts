// The cut-off date (fix plan Phase 1, register D01–D08): what an upload covers is decided by the date the books are
// closed to, never by the day of the export or of the upload.
import { cutLines, cutoffMessage } from "@/lib/ingest/cutoff";
import { describe, expect, it } from "vitest";
import { runChecks } from "@/lib/company/checks";
import { extractAll, ingest, runIngest, toAccountInputs, type IngestOptions } from "@/lib/ingest/pipeline";
import type { Grid } from "@/lib/ingest/extract";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-18" };
/** An Odoo General Ledger exported on 17 Oct: its last entry is a supplier bill dated 16 Oct. */
function gl(title = "From 01/01/2026\nto 10/17/2026"): Grid[] {
  const H = ["Code", "Account Name", "Date", "Communication", "Partner", "Currency", "Debit", "Credit", "Balance"];
  const acc = (code: string, name: string, bal: number, rows: [string, string, number][]) => [
    [code, name, null, null, null, null, bal > 0 ? bal : null, bal < 0 ? -bal : null, bal],
    ...rows.map(([ref, d, a]) => [null, ref, d, "x", "Gas Supplier", null, a > 0 ? a : null, a < 0 ? -a : null, null]),
    [null, `Total ${code} ${name}`, null, null, null, null, null, null, bal],
  ];
  const rows = [
    [null, null, title], [], H,
    ...acc("121101", "Main Cash Safe", 10000 - 5000, [["INV/2026/0001", "10/02/2026", 10000], ["BNK/2026/0004", "10/14/2026", -5000]]),
    ...acc("211100", "Suppliers", 5000 - 171, [["BNK/2026/0004", "10/14/2026", 5000], ["BILL/2026/0042", "10/16/2026", -171]]),
    ...acc("126000", "VAT Paid", 21, [["BILL/2026/0042", "10/16/2026", 21]]),
    ...acc("410000", "Revenues", -10000, [["INV/2026/0001", "10/02/2026", -10000]]),
    ...acc("622100", "Installation Cost", 150, [["BILL/2026/0042", "10/16/2026", 150]]),
  ];
  return [{ name: "General Ledger", rows }];
}
const cost = (r: ReturnType<typeof ingest>) => toAccountInputs(r).filter((a) => /Installation/.test(a.name)).reduce((s, a) => s + (a.amounts["2026-10"] ?? 0), 0);
const blocks = (r: ReturnType<typeof ingest>) => runChecks({ accounts: toAccountInputs(r).map((a, i) => ({ ...a, id: String(i) })), controls: r.controls, extra: r.checks }).filter((c) => c.severity === "block");

describe("the cut-off date", () => {
  it("without one, the part month runs to the last entry in the file, not to the export date", () => {
    const r = ingest(gl(), OPTS);
    expect(r.asOf).toBe("2026-10-16");
    expect(r.lastDay).toBe("2026-10-16");
  });

  it("with one, rows dated after it are left out and listed, and the month is labelled to it", () => {
    const r = ingest(gl(), { ...OPTS, cutoff: "2026-10-15" });
    expect(r.asOf).toBe("2026-10-15");
    expect(cost(r)).toBe(0);
    const note = r.checks.find((c) => c.id === "future_dated");
    expect(note?.title).toMatch(/after 15 Oct 2026/);
    expect(note?.detail).toContain("BILL/2026/0042");
    // The closing balances printed in the file still agree once those rows are left out.
    expect(blocks(r).map((c) => c.id)).not.toContain("account_rollforward");
  });

  it("a month after the cut-off month is dropped from any report, even one without dated rows", () => {
    const tb: Grid[] = [{ name: "P&L", rows: [["", "Sep 2026", "Oct 2026", "Nov 2026"], ["410000 Revenues", 100, 200, 300], ["522006 Office Rent", 10, 10, 10]] }];
    const r = ingest(tb, { ...OPTS, cutoff: "2026-10-15" });
    expect(r.periods).toEqual(["2026-09", "2026-10"]);
    expect(r.asOf).toBe("2026-10-15");
  });

  it("the upload date is never the label: a past month with no stop date is a full month", () => {
    const r = ingest(gl("From 01/01/2026\nto 10/31/2026"), { ...OPTS, today: "2026-11-02" });
    expect(r.asOf).toBeNull();
  });

  it("extractAll passes the cut-off to the readers", () => {
    const { raw, issues } = extractAll(gl(), {}, "2026-10-18", "2026-10-15");
    expect(raw.flatMap((l) => l.entries ?? []).some((e) => e.ref === "BILL/2026/0042")).toBe(false);
    expect(runIngest(raw, issues, { ...OPTS, cutoff: "2026-10-15" }).asOf).toBe("2026-10-15");
  });
});

describe("the cut-off date on sales and expense files", () => {
  const line = (day: string | null, period: string, amount: number, doc: string) => ({ day, period, amount, doc, src: { sheet: "Sales", row: 2 } });
  it("lines dated after the cut-off are left out and named; undated lines go by their month", () => {
    const lines = [line("2026-10-15", "2026-10", 100, "INV/1"), line("2026-10-16", "2026-10", 150, "INV/2"), line(null, "2026-10", 5, "INV/3"), line(null, "2026-11", 7, "INV/4")];
    const r = cutLines(lines, "2026-10-15");
    expect(r.kept.map((l) => l.doc)).toEqual(["INV/1", "INV/3"]);
    expect(r.late.map((l) => l.doc)).toEqual(["INV/2", "INV/4"]);
    expect(cutoffMessage(r.late, "2026-10-15")).toBe("2 lines dated after the cut-off, 15 Oct 2026, are left out (157): INV/2 on 16 Oct 2026, INV/4 in Nov 2026.");
  });
  it("no cut-off keeps everything", () => {
    const lines = [line("2026-10-16", "2026-10", 150, "INV/2")];
    expect(cutLines(lines, undefined)).toEqual({ kept: lines, late: [] });
  });
});

describe("no account left unmapped (register D12)", () => {
  it("an account with a code and any amount, however small, must be mapped before saving", async () => {
    const { materialUnmapped } = await import("@/lib/ingest/pipeline");
    const r = ingest(gl(), OPTS);
    const fake = { ...r, lines: [...r.lines, { ...r.lines[0], key: "x", code: "5499", name: "Odd write-off", label: "5499 Odd write-off", cls: null, values: { "2026-10": 0.01 }, entries: [] }] };
    expect(materialUnmapped(fake as never).map((l) => l.code)).toEqual(["5499"]);
  });
  it("Odoo's Sales Manual Discount is a revenue deduction", async () => {
    const { classify } = await import("@/lib/ingest/classify");
    expect(classify("Sales Manual Discount", "", null, {}, "5410").cls).toBe("revenue");
  });
});

describe("D6: cash books and bank statements follow the cut-off too", async () => {
  const { cutBooks } = await import("@/lib/ingest/cutoff");
  const l = (day: string, amount: number, doc = "") => ({ day, period: day.slice(0, 7), amount, doc });
  it("drops cash-book and bank lines after the cut-off, and says which", () => {
    const r = cutBooks({ sales: [l("2026-12-30", 100), l("2027-01-02", 50, "CB-9")], expenses: [l("2027-01-03", -20)] }, { sales: [l("2027-01-04", 70, "NBE")], expenses: [l("2026-12-31", -5)] }, "2026-12-31");
    expect(r.cash.sales.map((x) => x.amount)).toEqual([100]);
    expect(r.cash.expenses).toEqual([]);
    expect(r.bank.sales).toEqual([]);
    expect(r.bank.expenses.map((x) => x.amount)).toEqual([-5]);
    expect(r.late.map((x) => x.amount).sort()).toEqual([-20, 50, 70]);
  });
  it("keeps everything when there is no cut-off", () => {
    const cash = { sales: [l("2027-01-02", 50)], expenses: [] };
    expect(cutBooks(cash, { sales: [], expenses: [] }, undefined).cash).toEqual(cash);
  });
});
