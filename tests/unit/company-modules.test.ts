import { describe, expect, it } from "vitest";
import { customDefs, isOn, mayView, openExtras } from "@/lib/modules/company";
import { sectorsFor } from "@/components/shell/nav";

const row = (key: string, kind: "builtin" | "catalog" | "custom", enabled = true, extra: Record<string, unknown> = {}) => ({ key, kind, enabled, name: null, min_role: "viewer" as const, members: [], spec: null, ...extra });

describe("which modules a company has open", () => {
  it("built-in modules are on unless the company turned them off; catalog modules only once opened", () => {
    const rows = [row("inventory", "builtin", false), row("hr", "catalog")];
    expect(isOn("sales", rows)).toBe(true);
    expect(isOn("inventory", rows)).toBe(false);
    expect(isOn("hr", rows)).toBe(true);
    expect(isOn("crm", rows)).toBe(false);
  });
  it("who may see a module: the role from its row, HR admins-only by default, named people too", () => {
    expect(mayView("hr", [], "editor", "u1")).toBe(false);
    expect(mayView("hr", [], "admin", "u1")).toBe(true);
    expect(mayView("hr", [row("hr", "catalog", true, { min_role: "admin", members: ["u1"] })], "editor", "u1")).toBe(true);
    expect(mayView("crm", [row("crm", "catalog")], "viewer", "u2")).toBe(true);
    expect(mayView("sales", [], "viewer", "u2")).toBe(true);
  });
  it("custom modules become definitions; a broken one is skipped, never a crash", () => {
    const spec = { key: "c_visits", name: { en: "Visits", ar: "الزيارات" }, owns: { en: "Visits", ar: "الزيارات" },
      fields: [{ key: "clinic", label: { en: "Clinic", ar: "العيادة" }, type: "text", heading: "Clinic", headings: ["clinic"] }, { key: "fee", label: { en: "Fee", ar: "الرسوم" }, type: "money", heading: "Fee", headings: ["fee"] }],
      required: [["clinic"]], amount: "fee" };
    const defs = customDefs([row("c_visits", "custom", true, { spec }), row("c_bad", "custom", true, { spec: { nope: 1 } })]);
    expect(defs.map((d) => d.key)).toEqual(["c_visits"]);
  });
});

describe("navigation follows the company's modules", () => {
  it("hides a turned-off sector and shows a Modules sector for opened catalog and custom modules", () => {
    const s = sectorsFor([row("inventory", "builtin", false), row("hr", "catalog"), row("c_visits", "custom", true, { name: "Visits" })], "admin", "u1");
    const keys = s.map((x) => x.key);
    expect(keys).not.toContain("inventory");
    expect(keys).toContain("sales");
    const mods = s.find((x) => x.key === "modules")!;
    expect(mods.items.map((i) => i.href)).toEqual(["modules/hr", "modules/c_visits"]);
  });
  it("a module the person can't see is left off; with nothing opened there is no Modules sector", () => {
    expect(sectorsFor([row("hr", "catalog", true, { min_role: "admin" })], "editor", "u1").find((x) => x.key === "modules")).toBeUndefined();
    expect(sectorsFor([], "admin", "u1").map((x) => x.key)).toEqual(["financials", "sales", "expenses", "inventory", "payments", "banking", "planning", "doctor", "valuation"]);
  });
  it("turning off Financials hides the pages that need the books", () => {
    const keys = sectorsFor([row("financials", "builtin", false)], "admin", "u1").map((x) => x.key);
    for (const k of ["financials", "banking", "planning", "valuation"]) expect(keys).not.toContain(k);
  });
  it("Purchasing leaves Expenses when it is turned off", () => {
    const exp = sectorsFor([row("purchasing", "catalog", false)], "admin", "u1").find((x) => x.key === "expenses")!;
    expect(exp.items.map((i) => i.href)).not.toContain("modules/purchasing");
  });
  it("opened extras in order", () => {
    expect(openExtras([row("crm", "catalog"), row("hr", "catalog", false)], "admin", "u").map((m) => m.key)).toEqual(["crm"]);
  });
});
