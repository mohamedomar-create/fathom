// The independent review's findings, each pinned by the case that showed it.
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { pieceOf } from "@/lib/intake/split";
import { mapPiece } from "@/lib/intake/map";
import { readRecords } from "@/lib/intake/records";
import { bestModules } from "@/lib/intake/understand";
import { planIntake, placePiece } from "@/lib/intake/plan";
import { toPaymentLines } from "@/lib/intake/adapters";
import { MODULES, moduleByKey } from "@/lib/modules/registry";

const g = (name: string, rows: unknown[][]): Grid => ({ name, rows: rows as Grid["rows"] });
const read = (key: string, grid: Grid) => { const m = moduleByKey(key)!; const p = pieceOf(grid); return readRecords(p, m, mapPiece(p, m)); };

describe("C3 Arabic text is normalised before matching", () => {
  it("maps Arabic headings written with hamza and leaves out an Arabic total row", () => {
    const out = read("ar_open", g("العملاء", [["العميل", "رقم الفاتورة", "تاريخ الفاتورة", "تاريخ الاستحقاق", "قيمة الفاتورة", "المبلغ المتبقي"], ["أحمد", "INV/1", "01/10/2026", "31/10/2026", 1000, 1000], ["إيمان", "INV/2", "02/10/2026", "01/11/2026", 500, 500], ["الإجمالي", null, null, null, 1500, 1500]]));
    expect(out.records).toHaveLength(2);
    expect(out.records[0]).toMatchObject({ doc: "INV/1", date: "2026-10-01", total: 1000 });
    expect(out.proof).toMatchObject({ amountIn: 1500, ok: true, fileTotal: { stated: 1500, read: 1500, ok: true } });
  });
  it("reads Arabic purchasing headings", () => {
    const m = moduleByKey("purchasing")!;
    const map = mapPiece(pieceOf(g("P", [["أمر الشراء", "المورد", "تاريخ الطلب", "الكمية المطلوبة", "الإجمالي"], ["P1", "A", "01/10/2026", 2, 10]])), m);
    expect(Object.keys(map.cols).sort()).toEqual(["amount", "date", "ordered", "po", "supplier"]);
  });
});

describe("I1 a statement with a running balance is not open items", () => {
  it("is never sure as receivables", () => {
    const st = g("Statement", [["Date", "Partner", "Reference", "Amount", "Balance"], ["01/10/2026", "Nile", "INV/1", 1000, 1000], ["05/10/2026", "Nile", "PAY/1", -800, 200], ["09/10/2026", "Nile", "INV/2", 500, 700]]);
    const best = bestModules(pieceOf(st)).find((x) => x.module === "ar_open")!;
    expect(best.score).toBeLessThan(0.8);
  });
});

describe("I2 the as-of day the person gives wins", () => {
  it("over the title and the documents, and a guessed day must be confirmed", () => {
    const ar = g("AR", [["As of 15/09/2026"], ["Customer", "Invoice", "Invoice date", "Due date", "Balance due"], ["Nile", "INV/1", "01/09/2026", "15/09/2026", 100]]);
    const p = planIntake([ar]).pieces[0];
    expect(p.aged?.asOf).toBe("2026-09-15");
    const mine = placePiece(p.piece, "ar_open", {}, { asOf: "2026-11-06" });
    expect(mine.aged?.asOf).toBe("2026-11-06");
    const noTitle = planIntake([g("AR", [["Customer", "Invoice", "Invoice date", "Due date", "Balance due"], ["Nile", "INV/1", "01/09/2026", "15/09/2026", 100]])]).pieces[0];
    expect(noTitle.needs).toContain("as-of day");
    expect(noTitle.suggestedAsOf).toBe("2026-09-01");
  });
});

describe("I4 payment direction comes from the payment type, never from 'Paid'", () => {
  it("reads Receive / Send, and leaves cancelled and draft payments out with a reason", () => {
    const out = read("payments", g("P", [["Date", "Number", "Journal", "Partner", "Payment Type", "Amount", "Status"],
      ["01/10/2026", "P1", "Bank", "Nile", "Receive", 1000, "Paid"], ["02/10/2026", "P2", "Bank", "Power", "Send", 200, "Paid"], ["03/10/2026", "P3", "Bank", "X", "Send", 50, "Cancelled"], ["03/10/2026", "P4", "Bank", "Y", "Receive", 70, "Draft"]]));
    expect(out.records).toHaveLength(2);
    expect(out.rejected.map((r) => r.reason).join(" ")).toMatch(/cancelled.*draft/i);
    expect(toPaymentLines(out.records, "EGP").map((l) => [l.direction, l.amount])).toEqual([["in", 1000], ["out", -200]]);
  });
});

describe("I5 a month number is not a date serial", () => {
  it("keeps the Date's month when a Month column holds 10", () => {
    const out = read("sales", g("S", [["Date", "Month", "Customer", "Product", "Untaxed Amount"], ["01/10/2026", 10, "Nile", "Mask", 100]]));
    expect(out.records[0].__period).toBe("2026-10");
  });
});

describe("I6 every module kept in the shared store needs a date or month", () => {
  it("in its required fields (a snapshot is dated by its as-of column or the day the person gives)", () => {
    for (const m of MODULES.filter((x) => x.storage === "generic" && x.nature !== "snapshot")) {
      const dates = m.fields.filter((f) => f.type === "date" || f.type === "month").map((f) => f.key);
      expect(m.required.some((grp) => grp.every((k) => dates.includes(k))), m.key).toBe(true);
    }
  });
  it("a snapshot without its own date waits for the person's as-of day, and is then dated by it", () => {
    const hr = MODULES.find((m) => m.key === "hr")!;
    const piece = pieceOf({ name: "Staff", rows: [["Employee", "Department", "Monthly Wage"], ["Mona", "Sales", 100]] });
    const waiting = placePiece(piece, "hr");
    expect(waiting.needs).toEqual(["as-of day"]);
    const dated = placePiece(piece, "hr", {}, { asOf: "2026-10-31" });
    expect(dated.needs).toBeUndefined();
    expect(dated.read!.records[0].__period).toBe("2026-10");
    expect(hr.nature).toBe("snapshot");
  });
});

describe("I7 a real row named Total is not a total row", () => {
  it("keeps a customer called Total Egypt; skips a row whose only text is the total label", () => {
    const out = read("sales", g("S", [["Date", "Customer", "Product", "Untaxed Amount"], ["01/10/2026", "Total Egypt", "Mask", 100], ["02/10/2026", "Nile", "Total Care Kit", 50], ["Total", null, null, 150]]));
    expect(out.records).toHaveLength(2);
    expect(out.skipped).toHaveLength(1);
  });
});

describe("I8 the money proof counts every row with money", () => {
  it("including a row skipped as a section title that carries an amount", () => {
    const out = read("expenses", g("E", [["Date", "Vendor", "Amount"], ["01/10/2026", "A", 100], ["Utilities", null, 40]]));
    expect(out.proof.amountIn).toBe(140);
    expect(out.proof.amountIn).toBe(out.proof.amountOut + out.proof.amountRejected);
  });
});
