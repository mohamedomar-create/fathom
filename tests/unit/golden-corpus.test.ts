import { describe, expect, it } from "vitest";
import type { ClassKey } from "@/lib/engine";
import { ingest, type IngestOptions, type IngestResult } from "@/lib/ingest/pipeline";
import { readWorkbook } from "@/lib/ingest/read";
import { corpus, expectedRange, expectedTotals, MONTHS, type CorpusFile } from "../fixtures/egypt-corpus";

const BASE: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-10" };
const PL: ClassKey[] = ["revenue", "cos_variable", "exp_fixed", "exp_variable", "exp_depreciation"];
const BS: ClassKey[] = ["cash", "ar", "inventory", "fixed_assets", "ap", "tax_liab"];
const r2 = (x: number) => Math.round(x * 100) / 100 || 0;

/** Class totals of the imported lines at one month. */
function totalsAt(res: IngestResult, p: string) {
  const t: Partial<Record<ClassKey, number>> = {};
  for (const l of res.lines) if (l.cls && !l.excluded) t[l.cls] = (t[l.cls] ?? 0) + (l.values[p] ?? 0);
  return t;
}

async function load(f: CorpusFile) {
  const grids = await readWorkbook(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer, f.name);
  return ingest(grids, { ...BASE, ...f.opts });
}

describe("Egyptian file corpus: every file imports to the same books", () => {
  const files = corpus();
  it("has at least 25 files", () => expect(files.length).toBeGreaterThanOrEqual(25));

  for (const f of files) {
    it(`${f.name}: ${f.about}`, async () => {
      const res = await load(f);
      const unplaced = res.lines.filter((l) => !l.cls && !l.excluded && !l.system && Object.values(l.values).some((v) => Math.abs(v) > 0.5));
      expect(unplaced.map((l) => l.label), "accounts left unplaced").toEqual([]);
      const classes = [...(f.statements.includes("PL") ? PL : []), ...(f.statements.includes("BS") ? BS : [])];
      const checkAt = (p: string, want: Partial<Record<ClassKey, number>>) => {
        const got = totalsAt(res, p);
        for (const k of classes) expect(r2(got[k] ?? 0), `${f.name} ${p} ${k}`).toBe(r2(want[k] ?? 0));
        if (f.statements.includes("BS")) expect(Math.abs(res.imbalance[p] ?? 0), `${f.name} ${p} balance sheet balances`).toBeLessThan(1);
      };
      if (f.expect === "monthly") {
        const want = expectedTotals();
        for (const p of MONTHS) checkAt(p, want[p]);
      } else {
        expect(res.ranges, "a six-month range ending June").toEqual({ [MONTHS[5]]: 6 });
        checkAt(MONTHS[5], expectedRange());
      }
      const c = f.check ?? {};
      if (c.source) expect(res.layouts.find((l) => l.lines)?.source).toBe(c.source);
      if (c.dates) expect(res.layouts.find((l) => l.lines)?.dates?.order).toBe(c.dates);
      if (c.scale) expect(res.layouts.find((l) => l.lines)?.scale).toBe(c.scale);
      if (c.parents) expect(res.issues.subtotals.filter((s) => s.includes("parent account")).length).toBe(c.parents);
      if (c.unified) expect(res.issues.notes.some((n) => n.includes("unified chart"))).toBe(true);
      if (c.skippedBudget) expect(res.issues.skippedCols.length).toBe(MONTHS.length);
    });
  }
});
