import { describe, expect, it } from "vitest";
import { extractGrid, type ExtractIssues } from "@/lib/ingest/extract";
import type { Grid } from "@/lib/ingest/extract";

const issues = (): ExtractIssues => ({ skippedCols: [], warnings: [] });
const sum = (lines: { values: Record<string, number> }[], code: string, p: string, all: { code: string; values: Record<string, number> }[]) => all.filter((l) => l.code === code).reduce((s, l) => s + (l.values[p] ?? 0), 0);

// The owner's case: Code / Name / Debit / Credit with an "Accounting Date" column, every row an entry.
const LOOKALIKE: Grid = { name: "Journal Items", rows: [
  ["Accounting Date", "Code", "Name", "Label", "Debit", "Credit"],
  ["03/01/2026", "410000", "Revenues", "INV/2026/0001", null, 1000],
  ["03/01/2026", "122200", "Trade Receivables", "INV/2026/0001", 1000, null],
  ["15/01/2026", "620100", "Rent", "BILL/2026/0001", 300, null],
  ["15/01/2026", "121000", "Bank", "BILL/2026/0001", null, 300],
  ["02/02/2026", "410000", "Revenues", "INV/2026/0002", null, 500],
  ["02/02/2026", "122200", "Trade Receivables", "INV/2026/0002", 500, null],
] };

// Odoo's Journal Items list export: the account's code inside its name, a running balance, the move's number.
const FLAT: Grid = { name: "Journal Items (account.move.line)", rows: [
  ["Journal Items"], ["From 01/01/2026 to 28/02/2026"], [],
  ["Date", "Journal Entry", "Account", "Partner", "Label", "Debit", "Credit", "Balance"],
  ["2026-01-03", "INV/2026/0001", "410000 Revenues", "Nile Clinic", "Oxygen concentrator", 0, 1000, -1000],
  ["2026-01-03", "INV/2026/0001", "122200 Trade Receivables", "Nile Clinic", "", 1000, 0, 0],
  ["2026-01-15", "BILL/2026/0001", "620100 Rent", "Landlord", "January rent", 300, 0, 300],
  ["2026-01-15", "BILL/2026/0001", "121000 Bank", "Landlord", "", 0, 300, 0],
  ["2026-02-02", "INV/2026/0002", "410000 Revenues", "Delta Lab", "Masks", 0, 500.25, -500.25],
  ["2026-02-02", "INV/2026/0002", "122200 Trade Receivables", "Delta Lab", "", 500.25, 0, 0],
] };

describe("D3: a flat journal-items export is read as journal entries, never as a trial balance", () => {
  it("the owner's look-alike file (Accounting Date, Code, Name, Debit, Credit) reads as journal items with each month's movements", () => {
    const iss = issues();
    const lines = extractGrid(LOOKALIKE, iss, {}, "2026-10-12");
    expect(iss.layouts![0].source).toBe("Odoo Journal Items");
    expect(iss.layouts![0].kind).toBe("ledger");
    expect(sum(lines, "410000", "2026-01", lines)).toBe(-1000);
    expect(sum(lines, "410000", "2026-02", lines)).toBe(-500);
    expect(sum(lines, "620100", "2026-01", lines)).toBe(300);
    expect(lines.find((l) => l.code === "410000")!.entries).toHaveLength(2);
  });
  it("Odoo's Journal Items list (code inside the account name, a running balance) reads with exact totals", () => {
    const iss = issues();
    const lines = extractGrid(FLAT, iss, {}, "2026-10-12");
    expect(iss.layouts![0].source).toBe("Odoo Journal Items");
    const rev = lines.find((l) => l.code === "410000")!;
    expect(rev.name).toBe("Revenues");
    expect(rev.values).toEqual({ "2026-01": -1000, "2026-02": -500.25 });
    expect(rev.entries!.map((e) => [e.ref, e.partner, e.amount])).toEqual([["INV/2026/0001", "Nile Clinic", -1000], ["INV/2026/0002", "Delta Lab", -500.25]]);
    // Debits equal credits, month by month: nothing read twice, nothing missed.
    for (const p of ["2026-01", "2026-02"]) expect(Math.abs(lines.reduce((s, l) => s + (l.values[p] ?? 0), 0))).toBeLessThan(0.001);
  });
  it("the person can say how to read a sheet; the choice wins over the guess", () => {
    const iss = issues();
    extractGrid(LOOKALIKE, iss, { readAs: "trial-balance" }, "2026-10-12");
    expect(iss.layouts![0].source).not.toBe("Odoo Journal Items");
  });
});

describe("D3: the journal-items sample file", () => {
  it("reads back as Odoo Journal Items, debits equal to credits", async () => {
    const { buildTemplate } = await import("@/lib/templates/build");
    const { readWorkbook } = await import("@/lib/ingest/read");
    const { TEMPLATE_KINDS } = await import("@/lib/templates/spec");
    expect(TEMPLATE_KINDS).toContain("journal-items");
    const buf = await buildTemplate("journal-items", { year: 2026, fyStart: 1, currency: "EGP" });
    const grids = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "journal-items.xlsx");
    const sheet = grids.find((g) => /journal items/i.test(g.name))!;
    const iss = issues();
    const lines = extractGrid(sheet, iss, {}, "2026-10-12");
    expect(iss.layouts![0].source).toBe("Odoo Journal Items");
    expect(lines.length).toBeGreaterThan(2);
    const months = [...new Set(lines.flatMap((l) => Object.keys(l.values)))];
    for (const p of months) expect(Math.abs(lines.reduce((s, l) => s + (l.values[p] ?? 0), 0))).toBeLessThan(0.001);
  });
});
