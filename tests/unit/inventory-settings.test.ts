import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { inventorySettingsFromRow, settingsFromRow, RESERVED_KEYS } = await import("@/lib/company/load");

describe("the company's Inventory settings", () => {
  it("reads the rental location kept with the company, and never mistakes it for a KPI", () => {
    const row = { kpi_config: { inventory: { rentalLocation: "WH/Hire Pool" }, gpm: { target: 30 } } } as never;
    expect(inventorySettingsFromRow(row)).toEqual({ rentalLocation: "WH/Hire Pool", locationTypes: {} });
    expect(inventorySettingsFromRow({ kpi_config: {} } as never)).toEqual({ rentalLocation: null, locationTypes: {} });
    expect(RESERVED_KEYS).toContain("inventory");
    const { settings } = settingsFromRow({ currency: "EGP", fy_start_month: 1, tax_rate: 0.225, ...(row as object) } as never);
    expect(Object.keys(settings.targets ?? {})).not.toContain("inventory");
  });

  it("keeps only known location types", () => {
    const row = { kpi_config: { inventory: { rentalLocation: null, locationTypes: { "Repair & Maintenance": "outside", "WH/X": "bogus" } } } } as never;
    expect(inventorySettingsFromRow(row).locationTypes).toEqual({ "Repair & Maintenance": "outside" });
  });
});
