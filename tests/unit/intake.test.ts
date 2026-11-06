// The intake engine on messy, made-up workbooks: tabs split into tables, each table understood, mapped, read row by
// row, and every row either kept or listed with its reason; money in = money out.
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { splitGrid, pieceOf } from "@/lib/intake/split";
import { bestModules, understand, SURE, LIKELY } from "@/lib/intake/understand";
import { mapPiece } from "@/lib/intake/map";
import { readRecords } from "@/lib/intake/records";
import { moduleByKey } from "@/lib/modules/registry";
import { openItemsReport } from "@/lib/intake/open-items";
import { reconcile } from "@/lib/intake/reconcile";
import { planIntake } from "@/lib/intake/plan";

const g = (name: string, rows: unknown[][]): Grid => ({ name, rows: rows as Grid["rows"] });

const AR = g("AR", [
  ["Total Care Trading — customer balances"],
  ["As of 31/10/2026"],
  [],
  ["Customer", "Invoice", "Invoice date", "Due date", "Amount", "Balance due"],
  ["Nile Hospital", "INV/2026/0101", "05/08/2026", "04/09/2026", 12000, 12000],
  ["Delta Clinic", "INV/2026/0144", "20/09/2026", "20/10/2026", 5000, 2500],
  ["Cairo Labs", "INV/2026/0160", "15/10/2026", "14/11/2026", 8000, 8000],
  ["Total", null, null, null, 25000, 22500],
]);

const AP = g("الموردين", [
  ["المورد", "رقم الفاتورة", "التاريخ", "تاريخ الاستحقاق", "المبلغ المتبقي"],
  ["شركة النيل", "BILL/2026/0011", "01/07/2026", "31/07/2026", 7000],
  ["Delta Supplies", "BILL/2026/0019", "10/10/2026", "09/11/2026", 3000],
]);

const SALES = g("Sales", [
  ["Date", "Invoice", "Customer", "Product", "Quantity", "Untaxed Amount"],
  ["05/08/2026", "INV/2026/0101", "Nile Hospital", "Ventilator", 1, 12000],
  ["20/09/2026", "INV/2026/0144", "Delta Clinic", "Mask", 100, 5000],
  ["15/10/2026", "INV/2026/0160", "Cairo Labs", "Sensor", 4, 8000],
]);

describe("splitting a tab into tables", () => {
  it("keeps a single table whole, title rows above it", () => {
    const pieces = splitGrid(AR);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].title).toMatch(/customer balances/);
  });

  it("splits two tables side by side", () => {
    const side = g("Both", [
      ["Date", "Invoice", "Customer", "Amount", null, "Date", "Bill", "Vendor", "Amount"],
      ["01/10/2026", "INV/1", "A", 100, null, "02/10/2026", "BILL/1", "X", 40],
      ["03/10/2026", "INV/2", "B", 200, null, "04/10/2026", "BILL/2", "Y", 60],
    ]);
    const pieces = splitGrid(side);
    expect(pieces).toHaveLength(2);
    expect(pieces[1].origin.c).toBe(5);
    expect(pieces.map((p) => p.rows.length)).toEqual([3, 3]);
  });

  it("splits two tables stacked with a title between them", () => {
    const stack = g("Stack", [
      ["Date", "Customer", "Amount"],
      ["01/10/2026", "A", 100],
      ["02/10/2026", "B", 200],
      [],
      ["Expenses"],
      ["Date", "Vendor", "Amount"],
      ["03/10/2026", "X", 40],
    ]);
    const pieces = splitGrid(stack);
    expect(pieces).toHaveLength(2);
    expect(pieces[1].title).toBe("Expenses");
    expect(pieces[1].origin.r).toBe(5);
  });
});

describe("understanding each table", () => {
  it("knows a receivables list from a sales list from a payables list (English and Arabic headings)", () => {
    expect(bestModules(pieceOf(AR))[0].module).toBe("ar_open");
    expect(bestModules(pieceOf(SALES))[0].module).toBe("sales");
    expect(bestModules(pieceOf(AP))[0].module).toBe("ap_open");
  });

  it("bands its confidence: sure, likely, or unknown", () => {
    const u = understand(pieceOf(AR));
    expect(u.band).toBe("sure");
    expect(SURE).toBe(0.8);
    expect(LIKELY).toBe(0.5);
    const odd = understand(pieceOf(g("Odd", [["Zone", "Flag", "Score"], ["N", "x", 3], ["S", "y", 4]])));
    expect(odd.band).toBe("unknown");
  });
});

describe("reading rows: nothing lost", () => {
  it("keeps every data row or names why it left it out, and the file's own total is checked", () => {
    const m = moduleByKey("ar_open")!;
    const p = pieceOf(AR);
    const out = readRecords(p, m, mapPiece(p, m));
    expect(out.records).toHaveLength(3);
    expect(out.skipped.map((s) => s.reason)).toContain("total row");
    expect(out.proof.ok).toBe(true);
    expect(out.proof.amountIn).toBe(22500);
    expect(out.proof.amountOut).toBe(22500);
    expect(out.proof.fileTotal).toEqual({ stated: 22500, read: 22500, ok: true });
    // Row numbers are the spreadsheet's own.
    expect(out.records[0].__row).toBe(5);
  });

  it("lists a row with an unreadable date and keeps its amount in the proof", () => {
    const bad = g("AR", [["Customer", "Invoice", "Due date", "Balance"], ["A", "INV/1", "soon", 100], ["B", "INV/2", "31/10/2026", 50]]);
    const m = moduleByKey("ar_open")!;
    const p = pieceOf(bad);
    const out = readRecords(p, m, mapPiece(p, m));
    expect(out.records).toHaveLength(1);
    expect(out.rejected[0]).toMatchObject({ row: 2 });
    expect(out.rejected[0].reason).toMatch(/due date/i);
    expect(out.proof).toMatchObject({ amountIn: 150, amountOut: 50, amountRejected: 100, ok: true });
  });
});

describe("open items become an ageing report", () => {
  it("ages each open item from its due date at the as-of day", () => {
    const m = moduleByKey("ar_open")!;
    const p = pieceOf(AR);
    const r = openItemsReport(readRecords(p, m, mapPiece(p, m)).records, "receivable", "2026-10-31");
    expect(r.asOf).toBe("2026-10-31");
    expect(r.buckets).toEqual(["Not due", "1-30", "31-60", "61-90", "91-180", "181-365", "365+"]);
    expect(r.total.total).toBe(22500);
    // Nile: due 4 Sep → 57 days late; Delta: due 20 Oct → 11 days; Cairo: not due.
    expect(r.total.amounts).toEqual([8000, 2500, 12000, 0, 0, 0, 0]);
    expect(r.partners.map((x) => x.name).sort()).toEqual(["Cairo Labs", "Delta Clinic", "Nile Hospital"]);
    expect(r.errors).toEqual([]);
  });
});

describe("tabs checked against each other", () => {
  it("ties receivables to the invoices they come from", () => {
    const ar = moduleByKey("ar_open")!, sales = moduleByKey("sales")!;
    const pa = pieceOf(AR), ps = pieceOf(SALES);
    const res = reconcile([
      { id: "AR", module: "ar_open", records: readRecords(pa, ar, mapPiece(pa, ar)).records },
      { id: "Sales", module: "sales", records: readRecords(ps, sales, mapPiece(ps, sales)).records },
    ]);
    const tie = res.find((r) => r.key === "open_vs_invoices")!;
    expect(tie.status).toBe("ok");
  });

  it("flags an open item larger than its invoice, naming the document", () => {
    const ar = moduleByKey("ar_open")!, sales = moduleByKey("sales")!;
    const big = g("AR", [["Customer", "Invoice", "Due date", "Balance due"], ["Nile Hospital", "INV/2026/0101", "04/09/2026", 15000]]);
    const pa = pieceOf(big), ps = pieceOf(SALES);
    const res = reconcile([
      { id: "AR", module: "ar_open", records: readRecords(pa, ar, mapPiece(pa, ar)).records },
      { id: "Sales", module: "sales", records: readRecords(ps, sales, mapPiece(ps, sales)).records },
    ]);
    const tie = res.find((r) => r.key === "open_vs_invoices")!;
    expect(tie.status).toBe("off");
    expect(tie.items.join(" ")).toMatch(/INV\/2026\/0101/);
  });
});

describe("the whole workbook", () => {
  it("routes a five-tab workbook, one module each, and accounts for every row", () => {
    const EXP = g("Expenses", [["Date", "Vendor", "Category", "Amount"], ["02/10/2026", "Rent Co", "Rent", 9000], ["05/10/2026", "Power", "Utilities", 1200], ["Total", null, null, 10200]]);
    const INVOICES = g("Invoices", [["Invoice", "Customer", "Invoice date", "Due date", "Total"], ["INV/2026/0101", "Nile Hospital", "05/08/2026", "04/09/2026", 13680]]);
    const NOTES = g("Read me", [["This workbook was prepared by finance."]]);
    const plan = planIntake([AR, AP, EXP, INVOICES, SALES, NOTES]);
    const by = Object.fromEntries(plan.pieces.map((p) => [p.sheet, p.module]));
    expect(by).toMatchObject({ AR: "ar_open", "الموردين": "ap_open", Expenses: "expenses", Sales: "sales" });
    expect(["sales", "invoices"]).toContain(by.Invoices);
    expect(plan.left.find((l) => l.sheet === "Read me")?.reason).toMatch(/no figures/i);
    for (const p of plan.pieces) expect(p.read?.proof.ok, p.sheet).toBe(true);
    expect(plan.rows.read).toBe(plan.rows.kept + plan.rows.rejected + plan.rows.skipped);
  });
});

describe("messy cells", () => {
  it("reads Excel date serials, numbers typed as text, and Arabic digits", () => {
    const m = moduleByKey("expenses")!;
    const p = pieceOf(g("Bills", [["التاريخ", "المورد", "البند", "المبلغ"], [46300, "شركة الكهرباء", "كهرباء", "١٬٢٠٠٫٥٠"], [46301, "Rent Co", "Rent", "9,000.00"]]));
    const out = readRecords(p, m, mapPiece(p, m));
    expect(out.rejected).toEqual([]);
    expect(out.records.map((r) => r.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(out.records.map((r) => r.total)).toEqual([1200.5, 9000]);
    expect(out.proof.amountIn).toBe(10200.5);
  });

  it("fails the proof when the file's own total doesn't add up, and says by how much", () => {
    const m = moduleByKey("expenses")!;
    const p = pieceOf(g("Bills", [["Date", "Vendor", "Amount"], ["01/10/2026", "A", 100], ["02/10/2026", "B", 50], ["Total", null, 175]]));
    const out = readRecords(p, m, mapPiece(p, m));
    expect(out.proof.fileTotal).toEqual({ stated: 175, read: 150, ok: false });
    expect(out.proof.ok).toBe(false);
  });

  it("keeps a heading row found below title rows and remembers the mapping by heading", async () => {
    const { rememberable } = await import("@/lib/intake/map");
    const m = moduleByKey("sales")!;
    const p = pieceOf(g("S", [["Company X"], ["Sales report"], [], ["Inv date", "Client", "Net"], ["01/10/2026", "A", 10]]));
    const auto = mapPiece(p, m);
    // "Inv date" isn't a heading the sales reader knows: the person points it at Date, and the choice is remembered.
    expect(auto.missing).toContain("Date or Month");
    const fixed = mapPiece(p, m, { override: { 0: "date" } });
    expect(fixed.missing).toEqual([]);
    const saved = rememberable(p, fixed);
    expect(mapPiece(p, m, { saved }).cols).toEqual(fixed.cols);
    expect(readRecords(p, m, mapPiece(p, m, { saved })).records).toHaveLength(1);
  });

  it("splits receivables and payables placed side by side on one tab, each to its module", () => {
    const both = g("Balances", [
      ["Customer", "Invoice", "Due date", "Balance due", null, "Vendor", "Bill", "Due date", "Amount due"],
      ["Nile", "INV/1", "01/10/2026", 100, null, "Power", "BILL/1", "05/10/2026", 40],
      ["Delta", "INV/2", "01/11/2026", 200, null, "Rent", "BILL/2", "05/11/2026", 60],
    ]);
    const plan = planIntake([both], { asOf: "2026-10-31" });
    expect(plan.pieces.map((p) => p.module)).toEqual(["ar_open", "ap_open"]);
    expect(planIntake([both]).pieces[0].needs).toContain("as-of day");
    expect(plan.pieces[1].read!.records[0].__row).toBe(2);
    expect(plan.pieces[0].aged?.total.total).toBe(300);
  });
});

describe("remembered layouts", () => {
  it("places a layout the person mapped before, the same way, without asking", async () => {
    const { layoutKey } = await import("@/lib/intake/memory");
    const { rememberable } = await import("@/lib/intake/map");
    const odd = g("Foglio1", [["Cliente", "Fattura", "Scadenza", "Residuo"], ["Nile", "F1", "01/10/2026", 100]]);
    expect(planIntake([odd]).pieces[0].module).toBeNull();
    // The person maps it once.
    const m = moduleByKey("ar_open")!;
    const p = pieceOf(odd);
    const map = mapPiece(p, m, { override: { 0: "party", 1: "doc", 2: "due", 3: "open" } });
    const saved = { [layoutKey("ar_open", ["Cliente", "Fattura", "Scadenza", "Residuo"])]: rememberable(p, map) };
    const again = planIntake([odd], { saved, asOf: "2026-10-31" }).pieces[0];
    expect(again).toMatchObject({ module: "ar_open", band: "sure", remembered: true });
    expect(again.read!.records).toHaveLength(1);
    // A changed layout (a column added) is not taken as the same one.
    expect(layoutKey("ar_open", ["Cliente", "Fattura", "Scadenza", "Residuo", "Valuta"])).not.toBe(layoutKey("ar_open", ["Cliente", "Fattura", "Scadenza", "Residuo"]));
    expect(layoutKey("ar_open", [" cliente", "FATTURA", "Scadenza ", "residuo"])).toBe(layoutKey("ar_open", ["Cliente", "Fattura", "Scadenza", "Residuo"]));
  });
});
