import { describe, expect, it } from "vitest";
import { suggestSpec } from "@/lib/modules/suggest";
import { ModuleSpecSchema, specToDef } from "@/lib/modules/spec";
import { pieceOf } from "@/lib/intake/split";
import { mapPiece } from "@/lib/intake/map";
import { readRecords } from "@/lib/intake/records";

const visits = pieceOf({ name: "Clinic visits", rows: [
  ["Clinic visits Oct 2026"],
  ["Visit Date", "Clinic", "Doctor", "Patient ID", "Fee", "Minutes"],
  ["2026-10-01", "North", "Dr A", "P-001", 300.5, 20],
  ["2026-10-02", "South", "Dr B", "P-002", 250, 15],
  ["2026-10-03", "North", "Dr A", "P-003", 400, 30],
] });

describe("suggestSpec: a table no module knows becomes a draft module the person confirms", () => {
  it("finds the headings row, a field per column, and each field's type from its values", () => {
    const s = suggestSpec(visits);
    expect(s.key).toBe("c_clinic_visits");
    expect(s.fields.map((f) => [f.heading, f.type])).toEqual([["Visit Date", "date"], ["Clinic", "text"], ["Doctor", "text"], ["Patient ID", "code"], ["Fee", "money"], ["Minutes", "qty"]]);
    expect(s.amount).toBe("fee");
    expect(s.date).toBe("visit_date");
    expect(s.dimensions).toEqual(["clinic", "doctor"]);
    expect(s.measures).toEqual(["minutes"]);
  });
  it("is a valid definition that reads its own table back with the money proved", () => {
    const s = suggestSpec(visits);
    expect(ModuleSpecSchema.safeParse(s).success).toBe(true);
    const m = specToDef(s);
    const out = readRecords(visits, m, mapPiece(visits, m));
    expect(out.records).toHaveLength(3);
    expect(out.records.map((r) => r.__period)).toEqual(["2026-10", "2026-10", "2026-10"]);
    expect(out.proof.ok).toBe(true);
  });
  it("Arabic headings get plain keys and keep their words", () => {
    const s = suggestSpec(pieceOf({ name: "زيارات", rows: [["التاريخ", "العيادة", "الرسوم"], ["2026-10-01", "الشمال", 100], ["2026-10-02", "الجنوب", 120]] }));
    expect(s.fields.every((f) => /^[a-z][a-z0-9_]*$/.test(f.key))).toBe(true);
    expect(s.fields[1].headings).toContain("العيادة");
    expect(ModuleSpecSchema.safeParse(s).success).toBe(true);
  });
  it("a table with no money column gets an amount field to fill, never a broken module", () => {
    const s = suggestSpec(pieceOf({ name: "Tickets", rows: [["Date", "Team", "Ticket"], ["2026-10-01", "A", "T1"], ["2026-10-02", "B", "T2"]] }));
    expect(ModuleSpecSchema.safeParse(s).success).toBe(true);
    expect(s.fields.find((f) => f.key === s.amount)?.type).toBe("money");
  });
});
