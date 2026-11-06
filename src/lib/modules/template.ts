// iReport's own template for a module, built from its fields: the headings row then the rows. A filled template is read
// back with the same mapping as any other table, so what the wizard hands back ("download the AQL360 templates") is
// exactly what it would save.
import type { Grid } from "@/lib/ingest/extract";
import type { ModuleDef, ModuleField } from "./types";

export type Row = Record<string, string | number | null>;

/** The template as a sheet: headings, then one row per record (fields with no value left empty). */
export function templateGrid(m: ModuleDef, rows: Row[]): Grid {
  return { name: m.name.en, rows: [m.fields.map((f) => f.heading), ...rows.map((r) => m.fields.map((f) => r[f.key] ?? null))] };
}

function sample(m: ModuleDef, f: ModuleField, i: number): string | number {
  const n = i + 1;
  switch (f.type) {
    case "date": return `2026-10-${String(n * 3).padStart(2, "0")}`;
    case "month": return "2026-10";
    case "money": return 1000 * n + 250.5;
    case "qty": return n * 2;
    case "percent": return 10 * n;
    case "code": return f.key === "currency" ? "EGP" : `${m.docSide === "supplier" ? "BILL" : "INV"}/2026/${String(n).padStart(4, "0")}`;
    default: return `Sample ${f.label.en.toLowerCase()} ${n}`;
  }
}

/** Three made-up rows with every field filled: the demo rows and the contract suite's input. */
export function sampleRows(m: ModuleDef, count = 3): Row[] {
  return Array.from({ length: count }, (_, i) => Object.fromEntries(m.fields.map((f) => [f.key, sample(m, f, i)])));
}
