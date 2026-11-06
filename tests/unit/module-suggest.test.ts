import { describe, expect, it } from "vitest";
import { moduleKey, suggestSpec } from "@/lib/modules/suggest";
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

describe("moduleKey: a new module never takes a key already in use", () => {
  it("adds a number when the name's key is taken", () => {
    expect(moduleKey("Clinic visits", ["c_clinic_visits"])).toBe("c_clinic_visits_2");
    expect(moduleKey("Clinic visits", ["c_clinic_visits", "c_clinic_visits_2"])).toBe("c_clinic_visits_3");
  });
  it("a name with no Latin letters gets c_module_<n>, unique too", () => {
    expect(moduleKey("زيارات", [])).toBe("c_module_1");
    expect(moduleKey("زيارات", ["c_module_1"])).toBe("c_module_2");
  });
  it("suggestSpec takes the keys already in use", () => {
    expect(suggestSpec(visits, ["c_clinic_visits"]).key).toBe("c_clinic_visits_2");
  });
});

describe("suggestSpec field keys stay apart from the stored columns", () => {
  it("a text column called Amount and no money column: the added amount field gets its own key", () => {
    const s = suggestSpec(pieceOf({ name: "T", rows: [["Date", "Amount", "Team"], ["2026-10-01", "high", "A"], ["2026-10-02", "low", "B"]] }));
    const keys = s.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(ModuleSpecSchema.safeParse(s).success).toBe(true);
    expect(s.fields.find((f) => f.key === s.amount)?.type).toBe("money");
  });
  it("columns called Partner or Doc don't take the filter names of the stored party and document", () => {
    const s = suggestSpec(pieceOf({ name: "T", rows: [["Date", "Partner", "Doc", "Fee"], ["2026-10-01", "A", "X", 1], ["2026-10-02", "B", "Y", 2]] }));
    expect(s.fields.map((f) => f.key)).not.toContain("partner");
    expect(s.fields.map((f) => f.key)).not.toContain("doc");
  });
});
