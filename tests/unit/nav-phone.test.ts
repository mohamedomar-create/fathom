// Phase 4a: Financials in four groups, and the phone bottom bar (every company page reachable, no dead ends).
import { describe, expect, it } from "vitest";
import { SECTORS, bottomTab, navGroups, sectorOf } from "@/components/shell/nav";
import { en } from "@/lib/i18n/en";
import { ar } from "@/lib/i18n/ar";

describe("Financials in four groups", () => {
  it("groups the 12 pages as Overview, Performance, Cash & statements, Plan, in that order", () => {
    const g = navGroups(SECTORS.find((s) => s.key === "financials")!);
    expect(g.map((x) => x.key)).toEqual(["overview", "performance", "cash", "plan"]);
    expect(g.map((x) => x.items.map((i) => i.href))).toEqual([
      ["summary", "analysis/kpis", "analysis/explorer"],
      ["analysis/profitability", "analysis/growth", "analysis/trend", "analysis/real-profit"],
      ["analysis/cashflow", "analysis/financials"],
      ["analysis/forecast", "analysis/goalseek"],
    ]);
  });
  it("Planning is its own sector: Business plan, then Budget", () => {
    const p = SECTORS.find((s) => s.key === "planning")!;
    expect(p.items.map((i) => i.href)).toEqual(["planning", "planning/budget"]);
    expect(sectorOf("planning/budget").key).toBe("planning");
    expect(sectorOf("planning").key).toBe("planning");
    expect(ar.sectors.planning).toMatch(/[؀-ۿ]/);
  });
  it("other sectors are one group with no heading", () => {
    const g = navGroups(SECTORS.find((s) => s.key === "sales")!);
    expect(g).toHaveLength(1);
    expect(g[0].key).toBeNull();
  });
  it("every group heading has English and Arabic text", () => {
    for (const k of ["overview", "performance", "cash", "plan"] as const) {
      expect(en.navGroups[k]).toBeTruthy();
      expect(ar.navGroups[k]).toMatch(/[؀-ۿ]/);
    }
  });
});

describe("the phone bottom bar", () => {
  it("lights Home on Financials pages, Sales and Expenses on theirs, Pages on the other sectors, More on Data/Settings/Reports", () => {
    expect(bottomTab("/summary")).toBe("home");
    expect(bottomTab("/analysis/kpis")).toBe("home");
    expect(bottomTab("/sales/products")).toBe("sales");
    expect(bottomTab("/expenses")).toBe("expenses");
    expect(bottomTab("/inventory/movements")).toBe("pages");
    expect(bottomTab("/payments")).toBe("pages");
    expect(bottomTab("/data/checks")).toBe("more");
    expect(bottomTab("/settings/profile")).toBe("more");
    expect(bottomTab("/reports")).toBe("more");
  });
  it("sectorOf still sends unknown pages to Financials", () => {
    expect(sectorOf("/whatever").key).toBe("financials");
  });
});
