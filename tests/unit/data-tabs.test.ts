// Phase 4a: the Data section has three tabs; every old address still lights the right one.
import { describe, expect, it } from "vitest";
import { dataTabs } from "@/components/data/data-tabs";

const on = (rest: string, demo = false) => dataTabs(`/c/data${rest}`, "/c/data", demo).find((t) => t.active)?.key ?? null;

describe("Data tabs", () => {
  it("are Steps, Checks & history and Connections, in that order", () => {
    expect(dataTabs("/c/data", "/c/data", false).map((t) => t.key)).toEqual(["steps", "checks", "connections"]);
  });
  it("Upload and Readiness belong to Steps; Odoo live and End users to Connections", () => {
    expect(on("")).toBe("steps");
    expect(on("/upload")).toBe("steps");
    expect(on("/readiness")).toBe("steps");
    expect(on("/checks")).toBe("checks");
    expect(on("/odoo")).toBe("connections");
    expect(on("/end-users")).toBe("connections");
  });
  it("Connections opens Odoo live and is left out of the demo", () => {
    expect(dataTabs("/c/data", "/c/data", false).find((t) => t.key === "connections")?.href).toBe("/c/data/odoo");
    expect(dataTabs("/demo/data", "/demo/data", true).map((t) => t.key)).toEqual(["steps", "checks"]);
  });
});
