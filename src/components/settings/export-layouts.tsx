"use client";
import { useT } from "@/lib/i18n/use-t";

const fmtDate = (s: string, lang: string) => new Date(s).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

export interface LayoutRow { kind: string; sheet: string; headings: string[]; read: string[]; ignored: string[]; updatedAt: string; earlier: { headings: string[]; until: string }[] }

/** Each export the company uploads, as its Odoo lays it out: the columns read and ignored, and when the layout changed. */
export function ExportLayouts({ rows }: { rows: LayoutRow[] }) {
  const T = useT();
  const L = T.d.setx.layouts;
  const date = (s: string) => fmtDate(s, T.lang);
  const kindLabel = (k: string) => { const [what, how] = k.split(":"); return what === "accounts" ? how : `${L.kind[what] ?? what}${how && how !== "list" ? ` (${how})` : ""}`; };
  if (!rows.length) return <p className="text-sm text-mute">{L.none}</p>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line text-[13px]" data-testid="export-layouts">
      {rows.map((r) => (
        <li key={r.kind} className="px-3 py-2.5" data-testid="export-layout">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium">{kindLabel(r.kind)}</span>
            <span className="text-xs text-mute">{r.earlier.length ? L.changed(r.earlier.length, date(r.updatedAt)) : L.since(date(r.updatedAt))}</span>
          </div>
          <div className="mt-1 text-mute">{L.read} {r.read.join(", ") || "–"}{r.ignored.length ? <> · <span className="text-ink">{L.ignored} {r.ignored.join(", ")}</span></> : null}</div>
          {r.earlier[0] && <div className="mt-1 text-xs text-mute">{L.before(date(r.earlier[0].until))} {r.earlier[0].headings.join(", ")}</div>}
        </li>
      ))}
    </ul>
  );
}
