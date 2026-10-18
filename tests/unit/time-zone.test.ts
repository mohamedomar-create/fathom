import { describe, expect, it } from "vitest";
import { booksStartOf, timeZoneOf, validTimeZone, withProfile, withTimeZone } from "@/lib/company/time-zone";

describe("the company's time zone", () => {
  it("is none unless the company sets one (dates stay as Odoo's export shows them)", () => {
    expect(timeZoneOf({})).toBeNull();
    expect(timeZoneOf(null)).toBeNull();
    expect(timeZoneOf({ profile: { timeZone: "Africa/Cairo" } })).toBe("Africa/Cairo");
    expect(timeZoneOf({ profile: { timeZone: "Not/AZone" } })).toBeNull();
  });

  it("only real time zones are accepted, and saving one keeps every other setting", () => {
    expect(validTimeZone("Africa/Cairo")).toBe(true);
    expect(validTimeZone("UTC")).toBe(true);
    expect(validTimeZone("Cairo")).toBe(false);
    expect(withTimeZone({ inventory: { rentalLocation: "R" }, gpm: { target: 1 } }, "Asia/Riyadh")).toEqual({ inventory: { rentalLocation: "R" }, gpm: { target: 1 }, profile: { timeZone: "Asia/Riyadh" } });
  });
});

describe("books start setting", () => {
  it("is kept with the company's other settings and read back only as the first day of a month", () => {
    const cfg = withProfile({ inventory: { rentalLocation: "R" }, profile: { timeZone: "Africa/Cairo" } }, { booksStart: "2021-07-01" });
    expect(cfg).toEqual({ inventory: { rentalLocation: "R" }, profile: { timeZone: "Africa/Cairo", booksStart: "2021-07-01" } });
    expect(booksStartOf(cfg)).toBe("2021-07-01");
    expect(booksStartOf({ profile: { booksStart: "2021-06-30" } })).toBeNull();
    expect(booksStartOf(withProfile(cfg, { booksStart: null }))).toBeNull();
  });
});
