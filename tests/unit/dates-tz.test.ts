// Odoo writes date-times in UTC; a record belongs to the month it falls in where the company is (spec R3.4, R3.5).
import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import { readStockMoves, readStockValuation } from "@/lib/ingest/inventory";
import { parseDay } from "@/lib/ingest/parse";

const CAIRO = "Africa/Cairo";
const svl = (date: string | number | Date, extra: Partial<Grid> = {}): Grid => ({
  name: "svl", ...extra,
  rows: [[".id", "Date", "Product", "Quantity", "Total Value", "Reference"], [7, date, "[A1] Pump", 1, 100, "WH/IN/00001"]],
});
const sml = (date: string): Grid => ({
  name: "sml",
  rows: [[".id", "Date", "Product", "From", "To", "Quantity"], [9, date, "[A1] Pump", "Vendors", "WH/Stock", 1]],
});
/** Excel's serial number for a UTC time (1900 date system). */
const serial = (iso: string) => Date.parse(iso + "Z") / 86_400_000 + 25_569;

describe("the month a record belongs to", () => {
  it("a stock record at 22:30 UTC on 31 March is in April for a Cairo company", () => {
    expect(readStockValuation(svl("2026-03-31 22:30:00"), null, CAIRO)!.layers[0]).toMatchObject({ day: "2026-04-01", period: "2026-04" });
    expect(readStockMoves(sml("2026-03-31 22:30:00"), null, null, CAIRO)!.moves[0]).toMatchObject({ day: "2026-04-01", period: "2026-04" });
  });

  it("a record without an Odoo ID keeps the same key whatever the time zone", () => {
    const g = (): Grid => ({ name: "svl", rows: [["Date", "Product", "Quantity", "Total Value", "Reference"], ["2026-03-31 22:30:00", "[A1] Pump", 1, 100, "WH/IN/00001"]] });
    expect(readStockValuation(g(), null, CAIRO)!.layers[0].key).toBe(readStockValuation(g())!.layers[0].key);
  });

  it("a date-time cell read from Excel is moved the same way", () => {
    expect(readStockValuation(svl(new Date(2026, 2, 31, 22, 30)), null, CAIRO)!.layers[0].period).toBe("2026-04");
  });

  it("a plain date is never moved, and nothing moves when no time zone is set", () => {
    expect(readStockValuation(svl("2026-03-31"), null, CAIRO)!.layers[0].period).toBe("2026-03");
    expect(readStockValuation(svl("2026-03-31 22:30:00"))!.layers[0].period).toBe("2026-03");
  });

  it("an Excel serial number is a date, in the 1900 and the 1904 date systems", () => {
    expect(readStockValuation(svl(serial("2026-03-31T22:30:00")), null, CAIRO)!.layers[0].day).toBe("2026-04-01");
    expect(readStockValuation(svl(serial("2026-03-15T10:00:00")))!.layers[0].day).toBe("2026-03-15");
    expect(readStockValuation(svl(serial("2026-03-15T10:00:00") - 1462, { date1904: true }))!.layers[0].day).toBe("2026-03-15");
  });

  it("never guesses month-first: a date that is not valid day-first in a day-first column is refused", () => {
    expect(parseDay("13/05/2026", "dmy")).toBe("2026-05-13");
    expect(parseDay("05/13/2026", "dmy")).toBeNull();
    const g: Grid = { name: "svl", rows: [["Date", "Product", "Quantity", "Total Value", "Reference"], ["25/03/2026", "P", 1, 1, "WH/IN/1"], ["03/26/2026", "P", 1, 1, "WH/IN/2"]] };
    const r = readStockValuation(g)!;
    expect(r.layers).toHaveLength(1);
    expect(r.issues[0].message).toMatch(/Date is not readable: "03\/26\/2026"/);
  });
});
