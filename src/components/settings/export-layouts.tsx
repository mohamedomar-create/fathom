const fmtDate = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export interface LayoutRow { kind: string; sheet: string; headings: string[]; read: string[]; ignored: string[]; updatedAt: string; earlier: { headings: string[]; until: string }[] }

const KIND: Record<string, string> = { sales: "Sales list", bills: "Bills / expenses list" };
const kindLabel = (k: string) => { const [what, how] = k.split(":"); return what === "accounts" ? how : `${KIND[what] ?? what}${how && how !== "list" ? ` (${how})` : ""}`; };

/** Each export the company uploads, as its Odoo lays it out: the columns read and ignored, and when the layout changed. */
export function ExportLayouts({ rows }: { rows: LayoutRow[] }) {
  if (!rows.length) return <p className="text-sm text-mute">No layouts remembered yet. Each export’s columns are remembered on its first upload.</p>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line text-[13px]" data-testid="export-layouts">
      {rows.map((r) => (
        <li key={r.kind} className="px-3 py-2.5" data-testid="export-layout">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{kindLabel(r.kind)}</span>
            <span className="text-xs text-mute">{r.earlier.length ? `changed ${r.earlier.length} time${r.earlier.length > 1 ? "s" : ""}, last on ${fmtDate(r.updatedAt)}` : `since ${fmtDate(r.updatedAt)}`}</span>
          </div>
          <div className="mt-1 text-mute">Read: {r.read.join(", ") || "–"}{r.ignored.length ? <> · <span className="text-ink">ignored: {r.ignored.join(", ")}</span></> : null}</div>
          {r.earlier[0] && <div className="mt-1 text-xs text-mute">Before {fmtDate(r.earlier[0].until)}: {r.earlier[0].headings.join(", ")}</div>}
        </li>
      ))}
    </ul>
  );
}
