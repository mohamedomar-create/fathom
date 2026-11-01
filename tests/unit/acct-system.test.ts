// Phase 4a: "Which accounting system?" Odoo, another system or Excel, a cash book only, or not sure.
import { describe, expect, it } from "vitest";
import { systemOf, withSystem, suggestSystem, systemFlow } from "@/lib/company/system";

describe("the company's accounting system", () => {
  it("is unset until chosen, except that an Odoo or cash-book company already says which", () => {
    expect(systemOf({}, "upload")).toBeNull();
    expect(systemOf({}, "odoo")).toBe("odoo");
    expect(systemOf({ profile: { mode: "simple" } }, "upload")).toBe("cash");
    expect(systemOf({ profile: { system: "other" } }, "upload")).toBe("other");
  });
  it("a cash-book answer on a company back on the full system is ignored, so the picker asks again", () => {
    expect(systemOf({ profile: { system: "cash", mode: "full" } }, "upload")).toBeNull();
    expect(systemOf({ profile: { system: "cash" } }, "odoo")).toBe("odoo");
  });
  it("is kept on the profile with every other setting", () => {
    const k = withSystem({ profile: { vatRate: 0.14 }, targets: { a: 1 } }, "odoo");
    expect(k).toEqual({ profile: { vatRate: 0.14, system: "odoo" }, targets: { a: 1 } });
    expect(systemOf(k, "upload")).toBe("odoo");
  });
  it("Not sure: what the business keeps decides the suggestion", () => {
    expect(suggestSystem("notebook")).toBe("cash");
    expect(suggestSystem("odoo")).toBe("odoo");
    expect(suggestSystem("software")).toBe("other");
    expect(suggestSystem("accountant")).toBe("other");
  });
  it("each choice opens the right place: Odoo the Odoo steps, another system the templates, a cash book its own app", () => {
    expect(systemFlow("odoo")).toEqual({ mode: "full", source: "upload", exportHelp: "odoo" });
    expect(systemFlow("odoo", { live: true })).toEqual({ mode: "full", source: "odoo", exportHelp: "odoo" });
    expect(systemFlow("other")).toEqual({ mode: "full", source: "upload", exportHelp: "templates" });
    expect(systemFlow("cash")).toEqual({ mode: "simple", source: "upload", exportHelp: "none" });
  });
});
