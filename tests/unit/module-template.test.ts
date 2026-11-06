// Every module's own template: a Data sheet with its headings and a Read me that guides the person (fields, types,
// required, how to export from Odoo, SAP or Dynamics). A filled template reads straight back into that module.
import { describe, expect, it } from "vitest";
import { buildModuleTemplate } from "@/lib/modules/template-xlsx";
import { moduleGuide } from "@/lib/modules/guide";
import { CATALOG } from "@/lib/modules/catalog";
import { specToDef } from "@/lib/modules/spec";
import { sampleRows } from "@/lib/modules/template";
import { readWorkbook } from "@/lib/ingest/read";
import { planIntake } from "@/lib/intake/plan";

const ab = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe("buildModuleTemplate", () => {
  for (const m of CATALOG) {
    it(`${m.key}: a filled template reads back into ${m.key}, every row kept`, async () => {
      const buf = await buildModuleTemplate(m, { rows: sampleRows(m, 3) });
      const grids = await readWorkbook(ab(buf), `${m.key}.xlsx`);
      const plan = planIntake(grids, { asOf: "2026-10-31" });
      const placed = plan.pieces.filter((p) => p.module);
      expect(placed.map((p) => p.module)).toEqual([m.key]);
      expect(placed[0].read?.records.length).toBe(3);
      // The Read me is guidance, never a table to save.
      expect(plan.pieces.filter((p) => p.sheet.startsWith("Read me"))).toEqual([]);
    });
  }
  it("the blank template has only the headings, in the module's order", async () => {
    const m = CATALOG.find((x) => x.key === "hr")!;
    const grids = await readWorkbook(ab(await buildModuleTemplate(m)), "hr.xlsx");
    const data = grids.find((g) => g.name === "Data")!;
    expect(data.rows[0]).toEqual(m.fields.map((f) => f.heading));
    expect(data.rows.slice(1).filter((r) => (r ?? []).some((v) => v !== null && v !== ""))).toEqual([]);
  });
  it("a module the company built gets the same template", async () => {
    const c = specToDef({ key: "c_visits", name: { en: "Visits", ar: "الزيارات" }, owns: { en: "Visits", ar: "الزيارات" }, amount: "fee", date: "day", required: [["clinic"], ["day"]],
      fields: [{ key: "day", label: { en: "Visit date", ar: "تاريخ الزيارة" }, type: "date", heading: "Visit Date", headings: ["Visit Date"] }, { key: "clinic", label: { en: "Clinic", ar: "العيادة" }, type: "text", heading: "Clinic", headings: ["Clinic"] }, { key: "fee", label: { en: "Fee", ar: "الرسوم" }, type: "money", heading: "Fee", headings: ["Fee"] }] });
    const grids = await readWorkbook(ab(await buildModuleTemplate(c, { lang: "ar" })), "v.xlsx");
    expect(grids.find((g) => g.name === "Data")!.rows[0]).toEqual(["Visit Date", "Clinic", "Fee"]);
    expect(grids.some((g) => g.name.startsWith("Read me"))).toBe(true);
  });
});

describe("moduleGuide: how to get each module's data out of the ERP", () => {
  it("every catalog module has Odoo, SAP and Dynamics steps in English and Arabic", () => {
    for (const m of CATALOG) for (const sys of ["odoo", "sap", "dynamics"] as const) {
      const g = moduleGuide(m, sys);
      expect(g.steps.length, `${m.key} ${sys}`).toBeGreaterThan(0);
      for (const s of g.steps) { expect(s.en.length).toBeGreaterThan(5); expect(s.ar.length).toBeGreaterThan(5); }
    }
  });
  it("any module (a custom one too) has the template route as its plain-Excel guide", () => {
    const g = moduleGuide({ key: "c_x", name: { en: "X", ar: "س" } } as never, "excel");
    expect(g.steps[0].en).toMatch(/template/i);
  });
});
