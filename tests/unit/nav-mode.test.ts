import { describe, expect, it } from "vitest";
import { SECTORS, sectorOf, sectorsFor } from "@/components/shell/nav";

describe("navigation by company mode", () => {
  it("Full mode shows exactly today's sectors", () => {
    expect(sectorsFor("full")).toBe(SECTORS);
    expect(sectorOf("analysis/kpis").key).toBe("financials");
    expect(sectorOf("summary").key).toBe("financials");
  });
  it("Simple mode shows Overview, Sales and Expenses only", () => {
    expect(sectorsFor("simple").map((s) => s.key)).toEqual(["overview", "sales", "expenses"]);
  });
  it("Simple Overview holds the dashboard and Cash & forecast; Sales drops agency end users", () => {
    const s = sectorsFor("simple");
    expect(s[0].items.map((i) => i.href)).toEqual(["simple", "simple/cash"]);
    expect(s[1].items.some((i) => i.href === "sales/end-users")).toBe(false);
  });
  it("the Simple pages belong to the Overview sector", () => {
    expect(sectorOf("simple", "simple").key).toBe("overview");
    expect(sectorOf("simple/cash", "simple").key).toBe("overview");
    expect(sectorOf("sales/customers", "simple").key).toBe("sales");
  });
});
