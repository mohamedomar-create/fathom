// The cut-off date: what an upload covers is decided by the day the books are closed to, never by the export or upload day.
import { fmtDay } from "./odoo";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
type Dated = { day: string | null; period: string; amount: number; doc: string };

/** Lines after the cut-off are set aside; a line without a day goes by its month. */
export function cutLines<T extends Dated>(lines: T[], cutoff: string | undefined): { kept: T[]; late: T[] } {
  if (!cutoff) return { kept: lines, late: [] };
  const month = cutoff.slice(0, 7), kept: T[] = [], late: T[] = [];
  for (const l of lines) ((l.day ? l.day > cutoff : l.period > month) ? late : kept).push(l);
  return { kept, late };
}

/** "2 lines dated after the cut-off, 15 Oct 2026, are left out (217): INV/2 on 16 Oct 2026, …" */
export function cutoffMessage(late: Dated[], cutoff: string): string {
  const total = late.reduce((s, l) => s + l.amount, 0);
  const when = (l: Dated) => (l.day ? `on ${fmtDay(l.day)}` : `in ${MON[Number(l.period.slice(5)) - 1]} ${l.period.slice(0, 4)}`);
  const shown = late.slice(0, 4).map((l) => `${l.doc || "a line"} ${when(l)}`).join(", ");
  return `${late.length} line${late.length > 1 ? "s" : ""} dated after the cut-off, ${fmtDay(cutoff)}, ${late.length > 1 ? "are" : "is"} left out (${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}): ${shown}${late.length > 4 ? "…" : ""}.`;
}
