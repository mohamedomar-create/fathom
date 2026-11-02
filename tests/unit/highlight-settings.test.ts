// The company's highlight settings travel with its other settings, and are never mistaken for a KPI.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { settingsFromRow, RESERVED_KEYS } = await import("@/lib/company/load");
const { REQUIRED_SCHEMA } = await import("@/lib/schema");

describe("highlight settings", () => {
  it("are read with the company's settings and are not a KPI", () => {
    const row = { currency: "EGP", fy_start_month: 1, tax_rate: 0.225, kpi_config: { gpm: { target: 30 }, highlights: { pct: 10, amount: 5000, lines: { ta: { color: "green" } } } } };
    const { settings } = settingsFromRow(row as never);
    expect(settings.highlights).toEqual({ pct: 10, amount: 5000, lines: { ta: { color: "green" } } });
    expect(Object.keys(settings.targets ?? {})).not.toContain("highlights");
    expect(RESERVED_KEYS).toContain("highlights");
  });
  it("default when the company has none", () => {
    const { settings } = settingsFromRow({ currency: "EGP", fy_start_month: 1, tax_rate: 0.225, kpi_config: {} } as never);
    expect(settings.highlights).toEqual({ pct: 25, amount: 50000, lines: {} });
  });
  it("need database update 50", () => {
    expect(REQUIRED_SCHEMA).toBe(50);
  });
});
