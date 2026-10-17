export interface Diagnostic { file: string; size: number; sheets: { name: string; rows: number; cols: number; head: string[][] }[]; warnings: string[]; skipped: string[] }

/** Layout-only summary (first rows, truncated cells) to diagnose files the importer can't read. */
export function diagnostic(fs: { name: string; size: number }[], grids: { name: string; rows: unknown[][] }[], issues: { warnings: string[]; skippedCols: string[] }): Diagnostic {
  return {
    file: fs.map((f) => f.name).join(" + "), size: fs.reduce((a, f) => a + f.size, 0), warnings: issues.warnings, skipped: issues.skippedCols,
    sheets: grids.map((g) => ({
      name: g.name, rows: g.rows.length, cols: g.rows.reduce((m, r) => Math.max(m, r?.length ?? 0), 0),
      head: g.rows.slice(0, 15).map((r) => (r ?? []).slice(0, 16).map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null || c === undefined ? "" : String(c).slice(0, 60)))),
    })),
  };
}
