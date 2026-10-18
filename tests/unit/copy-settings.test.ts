// A company synced from Odoo for the first time knows none of the classes learned on another company of the same books:
// copying them makes it read every account the same way, and a person's own choices on the target are kept.
import { describe, expect, it } from "vitest";
import { settingsToCopy } from "@/lib/company/copy-settings";

const source = {
  accounts: [
    { code: "w.2", name: "Stock Interim (Received)", cls: "other_cl" as const },
    { code: "122100", name: "N/R - Notes Receivable", cls: "ar" as const },
    { code: "", name: "xy opining balance", cls: "other_equity" as const },
    { code: "532500", name: "Advertisement", cls: "exp_fixed" as const },
  ],
  map: { "#532500": "exp_variable" as const, "#999": "" as const },
  kpiConfig: { profile: { booksStart: "2021-07-01", openingAsAt: "2021-06-30", timeZone: "Africa/Cairo", booksFromZero: false } },
};

describe("copy settings from another company", () => {
  it("every account's class, by code (by name without one), with the person's choices winning", () => {
    const { entries } = settingsToCopy(source, {});
    const by = Object.fromEntries(entries.map((e) => [e.key, e.cls]));
    expect(by).toEqual({ "#w.2": "other_cl", "#122100": "ar", [Object.keys(by).find((k) => !k.startsWith("#"))!]: "other_equity", "#532500": "exp_variable", "#999": "" });
    expect(entries.find((e) => e.key === "#w.2")?.name).toBe("Stock Interim (Received)");
  });

  it("a class the target's people already chose is kept", () => {
    const { entries } = settingsToCopy(source, { "#122100": "other_ca" });
    expect(entries.find((e) => e.key === "#122100")).toBeUndefined();
  });

  it("the books start, opening date and time zone come along", () => {
    expect(settingsToCopy(source, {}).profile).toEqual({ booksStart: "2021-07-01", openingAsAt: "2021-06-30", timeZone: "Africa/Cairo", booksFromZero: false });
  });
});
