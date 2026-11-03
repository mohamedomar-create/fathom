import { describe, expect, it } from "vitest";
import { suggestSetup, emptySetup, setupDrift } from "@/lib/engine/budget-setup";
import type { SalesProductRow } from "@/lib/engine/sales";

const row = (p: string, r: string, g: string, a: number): SalesProductRow =>
  ({ p, r, g, s: "S", a, k: null, ka: null, q: null, n: 1 });

describe("budget setup suggestions", () => {
  it("top-15-by-estimate", () => {
    const rows: SalesProductRow[] = [];
    for (let i = 1; i <= 20; i++) rows.push(row("2026-01", `A${String(i).padStart(2, "0")}`, "G", i * 10));
    // A01 split over two months: 10 + 10 = 20, so it is still below A06 (60) and outside the top 15
    rows.push(row("2026-02", "A01", "G", 10));
    rows.push(row("2026-01", "No product", "G", 1000));
    rows.push(row("2026-01", "", "G", 999));
    const { setup } = suggestSetup(rows, {});
    expect(setup.products).toHaveLength(15);
    expect(setup.products[0]).toBe("A20");
    expect(setup.products).toContain("A06");
    expect(setup.products).not.toContain("A05");
    expect(setup.products).not.toContain("No product");
    expect(setup.products).not.toContain("");

    // summed over months, and ties by name ascending
    const tie = suggestSetup([
      row("2026-01", "Zeta", "G", 100),
      row("2026-01", "Beta", "G", 50),
      row("2026-01", "Alpha", "G", 50),
      row("2026-01", "Gamma", "G", 15),
      row("2026-01", "Gamma", "G", 15),
    ], { top: 3 });
    expect(tie.setup.products).toEqual(["Zeta", "Alpha", "Beta"]);
  });

  it("coverage", () => {
    const rows = [
      row("2026-01", "X", "G", 300),
      row("2026-01", "Y", "G", 100),
      row("2026-01", "Z", "G", 100),
      row("2026-01", "No product", "G", 100),
      row("2026-01", "Old", "G", 0),
    ];
    // top 2 = X (300) + Y (100, tie with Z by name) = 400 of 600
    expect(suggestSetup(rows, { top: 2 }).coverage).toBe(0.6667);
    expect(suggestSetup(rows, { top: 1 }).coverage).toBe(0.5);
    expect(suggestSetup([row("2026-01", "X", "G", 0)], {}).coverage).toBe(0);
    expect(suggestSetup([], {}).coverage).toBe(0);
  });

  it("rental-by-name", () => {
    const rows = [
      row("2026-01", "Office Rent", "G", 10),
      row("2026-01", "Equipment Rental", "G", 20),
      row("2026-01", "Staff Lease", "G", 5),
      row("2026-01", "Van Hire", "G", 3),
      row("2026-01", "Tea", "G", 50),
      row("2026-01", "إيجار المخزن", "G", 7),
      row("2026-01", "تأجير معدات", "G", 4),
      row("2026-01", "ايجار سيارة", "G", 2),
      row("2026-01", "Rentable Goods", "G", 1),
      row("2026-01", "Renovation", "G", 1),
    ];
    const { setup, hints } = suggestSetup(rows, {});
    expect(hints).toEqual([
      { key: "Equipment Rental", reason: "name" },
      { key: "Office Rent", reason: "name" },
      { key: "Staff Lease", reason: "name" },
      { key: "Van Hire", reason: "name" },
      { key: "إيجار المخزن", reason: "name" },
      { key: "ايجار سيارة", reason: "name" },
      { key: "تأجير معدات", reason: "name" },
    ]);
    expect(setup.streams.rental).toEqual(hints.map((h) => h.key));
  });

  it("rental-by-location-and-account", () => {
    const rows = [
      row("2026-01", "Office Rent", "G", 10),
      row("2026-01", "Trailer", "G", 30),
      row("2026-01", "Warehouse A", "G", 40),
      row("2026-01", "Tea", "G", 50),
    ];
    const { setup, hints } = suggestSetup(rows, {
      rentalProducts: ["Office Rent", "Trailer", "Warehouse A", "Hall B"],
      rentalAccounts: ["4500 Hire income"],
    });
    // Office Rent matches both location and name: one hint, reason location (first in order)
    expect(hints).toEqual([
      { key: "Hall B", reason: "location" },
      { key: "Office Rent", reason: "location" },
      { key: "Trailer", reason: "location" },
      { key: "Warehouse A", reason: "location" },
      { key: "acct:4500 Hire income", reason: "account" },
    ]);
    expect(setup.streams.rental).toEqual([
      "Hall B", "Office Rent", "Trailer", "Warehouse A", "acct:4500 Hire income",
    ]);
    expect(setup.products).toContain("Tea");
  });

  it("category-groups", () => {
    // groups in order of first appearance; "No product" and blank categories never form groups
    const rows = [
      row("2026-01", "Bread", "Food", 30),
      row("2026-01", "Tea", "Drinks", 20),
      row("2026-01", "Misc", "", 5),
      row("2026-01", "No product", "Food", 9),
      row("2026-01", "Cake", "Food", 10),
      row("2026-01", "Gift Card", "!!!", 8),
      row("2026-01", "خبز", "مخبوزات", 6),
      row("2026-01", "Soup", "FOOD", 4),
      row("2026-01", "Juice", "???", 2),
    ];
    const { setup } = suggestSetup(rows, {});
    expect(setup.groups).toEqual([
      { id: "food", name: "Food", products: ["Bread", "Cake"], customers: [] },
      { id: "drinks", name: "Drinks", products: ["Tea"], customers: [] },
      { id: "g1", name: "!!!", products: ["Gift Card"], customers: [] },
      { id: "مخبوزات", name: "مخبوزات", products: ["خبز"], customers: [] },
      { id: "food-2", name: "FOOD", products: ["Soup"], customers: [] },
      { id: "g2", name: "???", products: ["Juice"], customers: [] },
    ]);
    expect(setup.expenses).toEqual({ merged: [], excluded: [] });
    expect(emptySetup()).toEqual({
      products: [], groups: [], streams: { rental: [] }, expenses: { merged: [], excluded: [] },
    });
  });

  it("setup-drift", () => {
    const a = suggestSetup([
      row("2026-01", "Tea", "Drinks", 20),
      row("2026-01", "Bread", "Food", 30),
      row("2026-01", "Office Rent", "Rent", 10),
    ], { rentalAccounts: ["4500", "4100"] }).setup;
    const reordered = {
      products: [...a.products].reverse(),
      groups: [...a.groups].reverse(),
      streams: { rental: [...a.streams.rental].reverse() },
      expenses: { merged: [], excluded: [] },
    };
    expect(setupDrift(null, a)).toBe(false);
    expect(setupDrift(a, a)).toBe(false);
    expect(setupDrift(a, reordered)).toBe(false);
    expect(setupDrift(a, { ...a, products: [...a.products, "Extra"] })).toBe(true);
    expect(setupDrift(a, { ...a, groups: a.groups.map((g) => ({ ...g, customers: ["Acme"] })) })).toBe(true);
    expect(setupDrift(a, emptySetup())).toBe(true);
  });
});
