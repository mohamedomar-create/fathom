// A buying agency's own statement (each delivery with its hospital, funding and region) read only to say whose each Odoo
// invoice was: lines are paired with Odoo's agency invoices by amount and date, one to one, or several lines of one
// hospital and month to one combined invoice. Odoo's amounts are the only amounts counted; statement lines no invoice
// matches are listed apart and never become sales.
import { describe, expect, it } from "vitest";
import { readAgencyStatement } from "@/lib/ingest/agency-statement";
import { applyStatement, matchStatement, type AgencyInvoice, type AgencyLine, type EndUserRow } from "@/lib/engine";
import type { Grid } from "@/lib/ingest/extract";
import { parseEndUsers, resolveEndUsers } from "@/lib/company/end-users-parse";

const HEAD = ["Date", "DN #", "Inv #", "Describtion", "Name ( )", "po#", "Type", "area", "Value", "VAT", "Total Invioce", "Cash", "AR Balance"];
const grid = (rows: unknown[][]): Grid => ({ name: "UPA SOA", rows: [[null], HEAD, ...rows] as Grid["rows"] });

describe("reading the agency statement", () => {
  const g = grid([
    [new Date(Date.UTC(2021, 5, 20)), "1", "10", "Disposable", "مستشفى قديم", null, "مجانى", "cairo", 1000, 140, 1140, null, 0],
    [new Date(Date.UTC(2025, 2, 4)), "202503001", "28/25", "Disposable", "مستشفى الشفاء العام", 11586777, "اقتصادى", "delta", 50000, 7000, 57000, 45000, 12000],
    [new Date(Date.UTC(2025, 2, 4)), "202503001", "28/25", null, null, null, null, null, null, null, 0, 12000, 0],
    [new Date(Date.UTC(2025, 3, 9)), "202504002", null, "credit note", "مستشفى الشفاء العام", null, null, "delta", -5000, -700, -5700, null, null],
    [new Date(Date.UTC(2025, 3, 10)), "202504003", null, "Disposable", "مستشفى النور", null, "تأمين صحى", "upper ", 20000, 2800, 22800, null, null],
    ["End", "End", "End", "End", "End", null, null, null, 66000, 9240, 75240, 57000, null],
  ]);
  const r = readAgencyStatement(g, { booksStart: "2021-07-01" })!;
  it("invoice lines only: collection rows and the End row are not lines; credit notes stay negative", () => {
    expect(r.lines.map((l) => [l.day, l.hospital, l.value, l.funding, l.region])).toEqual([
      ["2025-03-04", "مستشفى الشفاء العام", 50000, "اقتصادى", "delta"],
      ["2025-04-09", "مستشفى الشفاء العام", -5000, "", "delta"],
      ["2025-04-10", "مستشفى النور", 20000, "تأمين صحى", "upper"],
    ]);
  });
  it("lines before the books start are left out and counted; the End row is checked against what was read", () => {
    expect(r.beforeStart).toEqual({ lines: 1, value: 1000 });
    expect(r.total).toBe(65000);
    expect(r.issues).toEqual([]);
  });
  it("an End row that disagrees is named", () => {
    const bad = grid([[new Date(Date.UTC(2025, 2, 4)), "1", "1", "x", "H", null, null, null, 100, 14, 114], ["End", "End", "End", "End", "End", null, null, null, 999]]);
    expect(readAgencyStatement(bad)!.issues.join(" ")).toMatch(/End row says 999/);
  });
  it("a line with no hospital is named, not guessed", () => {
    const g2 = grid([[new Date(Date.UTC(2025, 2, 4)), "1", "1", "x", null, null, null, null, 100, 14, 114]]);
    expect(readAgencyStatement(g2)!.issues.join(" ")).toMatch(/no hospital/i);
  });
  it("a sheet without these headings is not a statement", () => {
    expect(readAgencyStatement({ name: "x", rows: [["Code", "Account", "Balance"], ["1", "Cash", 5]] })).toBeNull();
  });
});

const L = (day: string, hospital: string, value: number, extra: Partial<AgencyLine> = {}): AgencyLine => ({ day, dn: "", ref: "", hospital, funding: "", region: "", value, sheet: "UPA SOA", ...extra });
const I = (doc: string, day: string, amount: number): AgencyInvoice => ({ doc, day, amount });

describe("pairing statement lines with Odoo's agency invoices", () => {
  it("same amount within the window, one to one; equal amounts paired in date order", () => {
    const m = matchStatement(
      [L("2025-03-01", "A", 26450), L("2025-03-20", "B", 26450), L("2025-04-01", "C", 99999)],
      [I("INV2/1", "2025-03-05", 26450), I("INV2/2", "2025-03-25", 26450), I("INV2/3", "2025-04-02", 777)],
    );
    expect(m.byDoc.get("INV2/1")?.hospital).toBe("A");
    expect(m.byDoc.get("INV2/2")?.hospital).toBe("B");
    expect(m.unmatchedInvoices).toEqual(["INV2/3"]);
    expect(m.unmatchedLines.map((l) => l.hospital)).toEqual(["C"]);
  });
  it("never outside the window: invoiced 15 days before to 120 days after the delivery", () => {
    const m = matchStatement([L("2025-01-01", "A", 500)], [I("INV2/9", "2025-06-01", 500)]);
    expect(m.byDoc.size).toBe(0);
  });
  it("one combined invoice for several deliveries of one hospital in a month", () => {
    const m = matchStatement([L("2026-06-03", "A", 100), L("2026-06-20", "A", 250), L("2026-06-21", "B", 250)], [I("INV2/5", "2026-07-01", 350)]);
    expect(m.byDoc.get("INV2/5")).toMatchObject({ hospital: "A", method: "statement-group" });
    expect(m.unmatchedLines.map((l) => l.hospital)).toEqual(["B"]);
  });
  it("single lines are paired first; combined lines only after", () => {
    const m = matchStatement([L("2026-06-03", "A", 100), L("2026-06-04", "A", 100), L("2026-06-05", "B", 200)], [I("INV2/6", "2026-06-30", 200), I("INV2/7", "2026-06-30", 200)]);
    expect([...m.byDoc.values()].map((x) => x.hospital).sort()).toEqual(["A", "B"]);
  });
  it("a combined total two hospitals could both make is left alone", () => {
    const m = matchStatement([L("2026-06-03", "A", 100), L("2026-06-04", "A", 100), L("2026-06-05", "B", 50), L("2026-06-06", "B", 150)], [I("INV2/8", "2026-06-30", 200)]);
    expect(m.byDoc.size).toBe(0);
    expect(m.unmatchedInvoices).toEqual(["INV2/8"]);
  });
});

describe("applying the matches to the end-user rows", () => {
  it("only invoices with no Odoo link take the statement's hospital; Odoo's amounts stay", () => {
    const rows: EndUserRow[] = [
      { p: "2025-03", c: "UPA", u: "", m: "" as const, g: "Disposable", o: "x", a: 26450, q: 1, n: 1, d: "INV2/1" },
      { p: "2025-03", c: "UPA", u: "Order Hospital", m: "order" as const, g: "Disposable", o: "", a: 26450, q: 1, n: 1, d: "INV2/2" },
    ];
    const m = matchStatement([L("2025-03-01", "Statement A", 26450, { funding: "مجانى", region: "cairo" })], [I("INV2/1", "2025-03-05", 26450)]);
    const out = applyStatement(rows, m);
    expect(out.map((r) => [r.u, r.m, r.a, r.f, r.r])).toEqual([["Statement A", "statement", 26450, "مجانى", "cairo"], ["Order Hospital", "order", 26450, undefined, undefined]]);
  });
});


describe("the end-user pages with a statement", () => {
  const d = parseEndUsers({
    rows: [
      { p: "2025-03", d: "INV2/1", day: "2025-03-05", c: "UPA", u: "", m: "", g: "Disposable", o: "Disposable", a: 26450, q: 1, n: 1 },
      { p: "2025-03", d: "INV2/2", day: "2025-03-06", c: "UPA", u: "Ordered Hospital", m: "order", g: "Disposable", o: "", a: 26450, q: 1, n: 1 },
      { p: "2025-03", d: "INV2/3", day: "2025-03-07", c: "UPA", u: "", m: "", g: "Disposable", o: "Disposable", a: 500, q: 1, n: 1 },
    ],
    map: [{ k: "agency", key: "UPA", h: "" }],
    statement: [{ day: "2025-03-01", dn: "1", ref: "", h: "Statement Hospital", f: "مجانى", r: "cairo", v: 26450, s: "UPA SOA" }, { day: "2025-03-02", dn: "2", ref: "", h: "Ordered Hospital", f: "", r: "", v: 26450, s: "UPA SOA" }],
  });
  const { analysis, match } = resolveEndUsers(d);
  it("an Odoo order link wins; the statement places only invoices Odoo has no link for", () => {
    expect(analysis.months[0]).toMatchObject({ total: 53400, order: 26450, statement: 26450, unmapped: 500 });
    expect(match.unmatchedInvoices).toEqual(["INV2/3"]);
  });
  it("agency sales are Odoo's to the pound, with or without the statement", () => {
    expect(analysis.total).toBe(resolveEndUsers({ ...d, statement: [] }).analysis.total);
  });
  it("the statement's funding type follows the hospital", () => {
    expect(analysis.hospitals.find((h) => h.name === "Statement Hospital")).toMatchObject({ byFunding: { "مجانى": 26450 }, region: "cairo" });
  });
  it("a statement line with no invoice left to match is listed apart, never added", () => {
    expect(match.unmatchedLines.map((l) => l.hospital)).toEqual(["Ordered Hospital"]);
  });
});

describe("D8: nothing on the statement is dropped without a word", async () => {
  const { mergeStatementLines } = await import("@/lib/ingest/agency-statement");
  it("a line with a value but no readable date is named", () => {
    const g = grid([["not a date", "5", "5", "Disposable", "مستشفى النور", null, null, null, 3000, 420, 3420], [new Date(Date.UTC(2025, 3, 10)), "6", null, "x", "مستشفى النور", null, null, null, 100, 14, 114]]);
    const r = readAgencyStatement(g)!;
    expect(r.lines).toHaveLength(1);
    expect(r.issues.join(" ")).toMatch(/1 line has a value but no readable date/);
  });
  it("two real deliveries with no delivery note are both kept; the same delivery note on two sheets counts once, and the merge is counted", () => {
    const line = (sheet: string, dn: string, value = 500) => ({ day: "2025-04-10", dn, ref: "", hospital: "مستشفى النور", funding: "", region: "", value, sheet });
    const reads = [
      { sheet: "SOA", lines: [line("SOA", ""), line("SOA", ""), line("SOA", "DN-1")], total: 1500, beforeStart: { lines: 0, value: 0 }, issues: [] },
      { sheet: "Spare parts", lines: [line("Spare parts", "DN-1")], total: 500, beforeStart: { lines: 0, value: 0 }, issues: [] },
    ];
    const r = mergeStatementLines(reads, new Set(["SOA", "Spare parts"]));
    expect(r.lines).toHaveLength(3);
    expect(r.merged).toBe(1);
  });
});
