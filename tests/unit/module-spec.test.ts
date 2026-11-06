import { describe, expect, it } from "vitest";
import { ModuleSpecSchema, specToDef } from "@/lib/modules/spec";
import { CATALOG_SPECS } from "@/lib/modules/catalog";
import { fieldOf, moduleByKey } from "@/lib/modules/registry";
import { bestModules } from "@/lib/intake/understand";
import { mapPiece } from "@/lib/intake/map";
import { readRecords } from "@/lib/intake/records";
import { pieceOf } from "@/lib/intake/split";

const visits = {
  key: "c_visits", name: { en: "Clinic visits", ar: "زيارات العيادة" }, owns: { en: "Visits", ar: "الزيارات" },
  fields: [
    { key: "clinic", label: { en: "Clinic", ar: "العيادة" }, type: "text", heading: "Clinic", headings: ["clinic", "العيادة"] },
    { key: "date", label: { en: "Date", ar: "التاريخ" }, type: "date", heading: "Visit Date", headings: ["visit date", "date"] },
    { key: "fee", label: { en: "Fee", ar: "الرسوم" }, type: "money", heading: "Fee", headings: ["fee", "الرسوم"] },
    { key: "status", label: { en: "Status", ar: "الحالة" }, type: "text", heading: "Status", headings: ["status"] },
  ],
  required: [["clinic"], ["date"]], amount: "fee", dimensions: ["clinic"], date: "date",
  exclude: [{ field: "status", values: ["No show"], reason: "a missed visit earned nothing" }],
} as const;

describe("module specs: a module written as data works like a module written in code", () => {
  it("turns into a definition the intake reads, Arabic headings included", () => {
    const m = specToDef(visits as never);
    expect(m.storage).toBe("generic");
    expect(fieldOf(m, "Visit Date")).toBe("date");
    expect(fieldOf(m, "العيادة")).toBe("clinic");
    expect(fieldOf(m, "Clinic name")).toBeNull();
  });
  it("leaves out rows its rule names, saying why", () => {
    const m = specToDef(visits as never);
    const piece = pieceOf({ name: "Visits", rows: [["Clinic", "Visit Date", "Fee", "Status"], ["North", "2026-10-01", 300, "Done"], ["North", "2026-10-02", 300, "No show"]] });
    const out = readRecords(piece, m, mapPiece(piece, m));
    expect(out.records).toHaveLength(1);
    expect(out.rejected[0].reason).toMatch(/missed visit/);
  });
  it("refuses a definition whose amount isn't money or names a missing field", () => {
    expect(ModuleSpecSchema.safeParse({ ...visits, amount: "clinic" }).success).toBe(false);
    expect(ModuleSpecSchema.safeParse({ ...visits, dimensions: ["nope"] }).success).toBe(false);
    expect(ModuleSpecSchema.safeParse({ ...visits, fields: [...visits.fields, visits.fields[0]] }).success).toBe(false);
  });
  it("every catalog spec is valid", () => {
    for (const s of CATALOG_SPECS) expect(ModuleSpecSchema.safeParse(s).success, s.key).toBe(true);
  });
});

describe("the catalog recognises real ERP exports", () => {
  it("a SAP-style employee list is HR, and a hire date never dates the list", () => {
    const piece = pieceOf({ name: "Employees", rows: [
      ["Personnel Number", "Employee Name", "Org. Unit", "Position", "Hire Date", "Monthly Salary"],
      ["1001", "Mona Adel", "Sales", "Rep", "2019-03-01", 15000],
      ["1002", "Omar Ali", "Finance", "Accountant", "2021-07-15", 18000],
    ] });
    expect(bestModules(piece)[0].module).toBe("hr");
    const hr = moduleByKey("hr")!;
    const out = readRecords(piece, hr, mapPiece(piece, hr));
    expect(out.records.map((r) => r.__period)).toEqual([null, null]);
    expect(readRecords(piece, hr, mapPiece(piece, hr), "2026-10-31").records.map((r) => r.__period)).toEqual(["2026-10", "2026-10"]);
  });
  it("an Odoo CRM pipeline export is CRM, and lost deals are left out", () => {
    const piece = pieceOf({ name: "Pipeline", rows: [
      ["Opportunity", "Customer", "Stage", "Salesperson", "Expected Revenue", "Probability", "Expected Closing"],
      ["Ventilators", "Cairo Hospital", "Proposition", "Sam", 500000, 60, "2026-11-30"],
      ["Monitors", "Alex Clinic", "Lost", "Lee", 90000, 0, "2026-10-15"],
    ] });
    expect(bestModules(piece)[0].module).toBe("crm");
    const crm = moduleByKey("crm")!;
    const out = readRecords(piece, crm, mapPiece(piece, crm));
    expect(out.records).toHaveLength(1);
    expect(out.proof.ok).toBe(true);
  });
});
