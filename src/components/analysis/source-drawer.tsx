"use client";
import { useEffect, useMemo, useState } from "react";
import { lineParts, money } from "@/lib/engine";
import { useCompany } from "@/lib/company/context";
import { loadProvenance, type Provenance } from "@/app/company/[id]/settings/actions";
import { CLASS_LABEL } from "@/lib/ingest/pipeline";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/use-t";

export interface SourceLine { key: string; label: string; statement: "PL" | "BS"; periods: string[] }

const fmtDate = (s: string, lang: string) => new Date(s).toLocaleDateString(lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Every account behind a figure, with the file, sheet and row it was imported from. */
export function SourceDrawer({ line, onClose }: { line: SourceLine | null; onClose: () => void }) {
  const c = useCompany();
  const T = useT();
  const t = T.d.ana;
  const cur = c.settings.currency;
  // Provenance is kept with the figure it was loaded for, so a stale answer is never shown for another figure.
  const [loaded, setLoaded] = useState<{ for: SourceLine; data: Record<string, Record<string, Provenance>> } | null>(null);
  const prov = loaded && loaded.for === line ? loaded.data : null;
  const live = c.basePath !== "/demo" && c.source !== "demo";

  const rows = useMemo(() => {
    if (!line) return [];
    const parts = lineParts(line.key);
    // P&L figures sum the window's months; balance-sheet figures are the closing month.
    const ps = line.statement === "BS" ? line.periods.slice(-1) : line.periods;
    return parts.flatMap(({ cls, sign }) => c.accounts.filter((a) => a.cls === cls).map((a) => ({
      a, cls, sign, value: ps.reduce((s, p) => s + (a.amounts[p] ?? 0), 0) * sign, months: ps.filter((p) => a.amounts[p]),
    }))).filter((r) => Math.abs(r.value) > 0.005).sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
  }, [line, c.accounts]);
  const total = rows.reduce((s, r) => s + r.value, 0);

  useEffect(() => {
    if (!line || !live || !rows.length) return;
    let gone = false;
    loadProvenance(c.id, rows.slice(0, 400).map((r) => r.a.id), line.statement === "BS" ? line.periods.slice(-1) : line.periods)
      .then((data) => { if (!gone) setLoaded({ for: line, data }); }).catch(() => { if (!gone) setLoaded({ for: line, data: {} }); });
    return () => { gone = true; };
  }, [line, live, rows, c.id]);

  const source = (id: string, months: string[]) => {
    if (!live) return <span className="text-mute">{t.demoData}</span>;
    if (!prov) return <span className="text-mute">…</span>;
    const seen = new Map<string, Provenance & { months: string[] }>();
    for (const p of months) {
      const x = prov[id]?.[p];
      if (!x) continue;
      const k = `${x.file}|${x.at}|${x.sheet}|${x.row}`;
      const e = seen.get(k) ?? { ...x, months: [] };
      e.months.push(p); seen.set(k, e);
    }
    if (!seen.size) return <span className="text-mute">–</span>;
    return [...seen.values()].map((x) => (
      <div key={`${x.file}${x.at}${x.row}`} className="text-[12px]">
        <span className="font-medium text-ink">{x.file}</span>
        {x.sheet ? <span className="text-mute"> · {x.sheet}{x.row ? ` ${t.row(x.row)}` : ""}</span> : null}
        {x.at ? <span className="text-mute"> · {fmtDate(x.at, T.lang)}</span> : null}
        {seen.size > 1 || months.length > 1 ? <span className="text-mute"> · {x.months.length === 1 ? T.ml(x.months[0]) : t.monthsN(x.months.length)}</span> : null}
      </div>
    ));
  };

  return (
    <Dialog open={!!line} onOpenChange={(o) => { if (!o) onClose(); }}>
      {line && (
        <DialogContent title={t.whereFrom(line.label)} className="w-[min(860px,calc(100vw-24px))] p-6" data-testid="source-drawer">
          <div className="label">{t.whereFigure}</div>
          <h2 className="mb-1 text-2xl font-light">{line.label}</h2>
          <p className="mb-4 text-sm text-mute">
            {line.statement === "BS" ? t.closing(T.ml(line.periods[line.periods.length - 1])) : line.periods.length === 1 ? T.ml(line.periods[0]) : `${T.ml(line.periods[0])} – ${T.ml(line.periods[line.periods.length - 1])}`}
            {" · "}{t.accounts(rows.length)} · {t.total} <b className="text-ink">{money(total, cur)}</b>
          </p>
          <div className="overflow-x-auto">
            <table className="tbl text-[13px]">
              <thead><tr><th className="!text-start">{t.account}</th><th className="!text-start">{t.cls}</th><th>{t.amount}</th><th className="!text-start">{t.importedFrom}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.a.id + r.cls} className="row align-top">
                    <td className="!text-start"><div className="text-xs text-mute">{r.a.code}</div>{r.a.name}</td>
                    <td className="!text-start text-mute">{CLASS_LABEL[r.cls]}{r.sign < 0 ? " (−)" : ""}</td>
                    <td>{money(r.value, cur)}</td>
                    <td className="max-w-80 whitespace-normal !text-start">{source(r.a.id, r.months)}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={4} className="py-6 text-center text-mute">{t.noAccounts}</td></tr>}
                {rows.length > 0 && <tr className="tot"><td className="!text-start">{t.totalCap}</td><td /><td>{money(total, cur)}</td><td /></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-mute">{t.drawerFoot}</p>
        </DialogContent>
      )}
    </Dialog>
  );
}
