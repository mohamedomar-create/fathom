import { cleanHeading } from "./odoo-templates";
import type { SheetLayout } from "./extract";
import type { SalesLayout } from "./sales";
import type { ExpenseLayout } from "./expenses";
import type { UploadIssue } from "./sorted";

/**
 * Each company's Odoo is customised, so its exports differ from another company's. The first upload of each export is
 * remembered as that company's layout; a later upload whose columns differ stops until the person confirms how it was read.
 */
export interface SheetFingerprint {
  /** Which export: "accounts:Odoo General Ledger", "sales:list", "bills:list"… */
  kind: string;
  sheet: string;
  /** Every heading that is not a month, as compared (Arabic letter forms unified, Odoo's required star removed, lower case). */
  headings: string[];
  /** Headings as shown in the file: read, and left out. */
  read: string[];
  ignored: string[];
}
export type SavedLayouts = Record<string, string[]>;

const norm = (h: string) => cleanHeading(h).toLowerCase();

export function fingerprintList(kind: string, sheet: string, headers: string[], usedCols: number[]): SheetFingerprint {
  const used = new Set(usedCols);
  const cols = headers.map((h, i) => ({ h: String(h ?? "").trim(), i })).filter((c) => c.h);
  return { kind, sheet, headings: cols.map((c) => norm(c.h)), read: cols.filter((c) => used.has(c.i)).map((c) => c.h), ignored: cols.filter((c) => !used.has(c.i)).map((c) => c.h) };
}

export function fingerprintAccounts(l: SheetLayout): SheetFingerprint {
  // The readers note every non-month heading they saw; older layouts only list their columns.
  if (l.headings?.length) return fingerprintList(`accounts:${l.source ?? l.kind}`, l.sheet, l.headings.map((h) => h.header), l.headings.flatMap((h, i) => (h.used ? [i] : [])));
  const cols = l.columns.filter((c) => !c.period);
  return fingerprintList(`accounts:${l.source ?? l.kind}`, l.sheet, cols.map((c) => c.header), cols.filter((c) => c.used).map((c) => cols.indexOf(c)));
}
export const fingerprintSales = (l: SalesLayout) => { const cols = l.columns.filter((c) => !c.period); return fingerprintList(`sales:${l.kind}`, l.sheet, cols.map((c) => c.header), cols.flatMap((c, i) => (c.field ? [i] : []))); };
export const fingerprintBills = (l: ExpenseLayout) => fingerprintList(`bills:${l.kind}`, l.sheet, l.columns.map((c) => c.header), l.columns.flatMap((c, i) => (c.field ? [i] : [])));

export type LayoutStatus = { status: "new" } | { status: "same" } | { status: "changed"; added: string[]; removed: string[] };

/** The export's headings against the company's remembered layout. */
export function compareLayout(fp: SheetFingerprint, saved: string[] | undefined): LayoutStatus {
  // Nothing usable remembered (a layout saved before the reader noted its headings) counts as the first upload.
  if (!saved || !saved.length) return { status: "new" };
  const was = new Set(saved), now = new Set(fp.headings);
  const shown = new Map(fp.headings.map((h, i) => [h, [...fp.read, ...fp.ignored].find((x) => norm(x) === h) ?? fp.headings[i]]));
  const added = fp.headings.filter((h) => !was.has(h)).map((h) => shown.get(h)!);
  const removed = saved.filter((h) => !now.has(h));
  return added.length || removed.length ? { status: "changed", added, removed } : { status: "same" };
}

const list = (xs: string[]) => xs.map((x) => `"${x}"`).join(", ");

/** What the person sees: a changed layout blocks until confirmed; the first upload of an export is shown to check. */
export function layoutIssues(fps: SheetFingerprint[], saved: SavedLayouts, confirmed: Set<string>): UploadIssue[] {
  const out: UploadIssue[] = [];
  for (const fp of fps) {
    const c = compareLayout(fp, saved[fp.kind]);
    const name = fp.sheet.split(" › ").pop();
    if (c.status === "same") continue;
    if (c.status === "new") {
      // The first upload is remembered quietly; only columns it would leave out are listed, so none is dropped unseen.
      if (!fp.ignored.length) continue;
      out.push({ id: `layout:${fp.kind}:${fp.sheet}`, severity: "check", sheet: fp.sheet, fix: "layout", key: fp.kind,
        message: `${name}: the first ${fp.kind.split(":").pop()} export for this company. Read: ${fp.read.join(", ") || "none"}; ignored: ${fp.ignored.join(", ")}. Saving remembers this layout.` });
      continue;
    }
    const parts = [c.added.length ? `new column${c.added.length > 1 ? "s" : ""} ${list(c.added)}` : "", c.removed.length ? `${list(c.removed)} ${c.removed.length > 1 ? "are" : "is"} gone` : ""].filter(Boolean).join("; ");
    out.push({ id: `layout:${fp.kind}:${fp.sheet}`, severity: confirmed.has(fp.kind) ? "check" : "error", sheet: fp.sheet, fix: "layout", key: fp.kind,
      message: `${name}: this export's columns changed since the last upload (${parts}). Check how each column was read${fp.ignored.length ? ` (ignored: ${fp.ignored.join(", ")})` : ""}, then confirm.` });
  }
  return out;
}
