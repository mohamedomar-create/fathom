// Every module definition passes the same checks: a new module is a definition file, and this suite proves it fits the
// workflow (its template is recognised as itself and reads back exactly, its rules reject bad rows, its names exist in
// English and Arabic).
import { describe, expect, it } from "vitest";
import { MODULES, moduleByKey } from "@/lib/modules/registry";
import { templateGrid, sampleRows } from "@/lib/modules/template";
import { recognise, bestModules } from "@/lib/intake/understand";
import { mapPiece } from "@/lib/intake/map";
import { readRecords } from "@/lib/intake/records";
import { pieceOf } from "@/lib/intake/split";

describe("module registry", () => {
  it("has unique keys and the modules the intake routes to", () => {
    const keys = MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["sales", "expenses", "ar_open", "ap_open", "payments", "purchasing"]) expect(keys).toContain(k);
    expect(moduleByKey("sales")?.key).toBe("sales");
    expect(moduleByKey("nope")).toBeNull();
  });

  it("puts every module's page in a sector the navigation knows", async () => {
    const { MODULE_SECTOR } = await import("@/lib/modules/sectors");
    const { sectorOf } = await import("@/components/shell/nav");
    expect(MODULE_SECTOR).toEqual(Object.fromEntries(MODULES.map((m) => [m.key, m.sector])));
    expect(sectorOf("modules/purchasing").key).toBe("expenses");
  });

  for (const m of MODULES) {
    describe(m.key, () => {
      it("names itself and its fields in English and Arabic", () => {
        expect(m.name.en.trim()).not.toBe("");
        expect(m.name.ar.trim()).not.toBe("");
        for (const f of m.fields) {
          expect(f.label.en.trim(), f.key).not.toBe("");
          expect(f.label.ar.trim(), f.key).not.toBe("");
        }
      });

      it("requires only fields it has, and proves its totals on a money field", () => {
        const keys = new Set(m.fields.map((f) => f.key));
        for (const g of m.required) for (const k of g) expect(keys.has(k), `${m.key}.${k}`).toBe(true);
        const amount = m.fields.find((f) => f.key === m.amount);
        expect(amount?.type).toBe("money");
      });

      it("recognises its own template as itself, sure", () => {
        const g = templateGrid(m, sampleRows(m));
        const ranked = bestModules(pieceOf(g));
        expect(ranked[0].module).toBe(m.key);
        expect(ranked[0].score).toBeGreaterThanOrEqual(0.8);
        expect(recognise(m, pieceOf(g)).score).toBeGreaterThanOrEqual(0.8);
      });

      it("reads its template back exactly", () => {
        const rows = sampleRows(m);
        const piece = pieceOf(templateGrid(m, rows));
        const map = mapPiece(piece, m);
        expect(map.missing).toEqual([]);
        const out = readRecords(piece, m, map);
        expect(out.rejected).toEqual([]);
        expect(out.records).toHaveLength(rows.length);
        for (let i = 0; i < rows.length; i++) for (const f of m.fields) {
          const want = rows[i][f.key];
          if (want === undefined || want === null || want === "") continue;
          expect(out.records[i][f.key], `${m.key} row ${i} ${f.key}`).toEqual(want);
        }
        expect(out.proof.ok).toBe(true);
      });

      it("rejects a row with a required field empty, saying which", () => {
        const rows = sampleRows(m);
        const need = m.required[0];
        const bad = { ...rows[0] };
        for (const k of need) bad[k] = null;
        const piece = pieceOf(templateGrid(m, [bad, ...rows.slice(1)]));
        const out = readRecords(piece, m, mapPiece(piece, m));
        expect(out.rejected).toHaveLength(1);
        expect(out.rejected[0].reason).toMatch(new RegExp(m.fields.find((f) => f.key === need[0])!.label.en, "i"));
        expect(out.records).toHaveLength(rows.length - 1);
        expect(out.proof.ok).toBe(true);
      });
    });
  }
});
