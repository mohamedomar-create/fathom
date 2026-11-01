"use client";
import { toCsv, type PreflightRun } from "@/lib/preflight";
import { useDict } from "@/lib/i18n/context";

/** What preflight hands to the confirmation screen: sheets, rows to import and to skip, warnings and transformations. */
export function preflightTotals(run: PreflightRun) {
  const sheets = run.final.sheets.filter((s) => s.include);
  const rows = sheets.reduce((n, s) => n + s.dataRows, 0);
  const leftOutSheets = run.report.sheets.filter((s) => !run.cleaned.grids.some((g) => g.name === s.sheet));
  const warnings = run.report.sheets.filter((s) => s.include).flatMap((s) => s.issues.filter((i) => i.fix === "source" && i.level !== "block").map((i) => `${s.sheet}: ${i.message}`));
  return { sheets, rows, skipped: run.cleaned.rejected.length, leftOutSheets, warnings, changes: run.cleaned.changes };
}

/**
 * The pre-import summary of the preflight: shown on the save screen, above the button that confirms the import, so the
 * person sees exactly what goes in, what is skipped and what was changed before anything is saved.
 */
/** "N accounts × M months" for an accounts file: what it holds, counted the way an accountant reads it. */
export function accountsCounted(res: { lines: { key: string }[]; slices: { PL: string[]; BS: string[] } }, say: (accounts: string, months: number) => string = (a, m) => `${a} accounts × ${m} months`): string {
  const accounts = new Set(res.lines.map((l) => l.key)).size;
  const months = new Set([...res.slices.PL, ...res.slices.BS]).size;
  return say(accounts.toLocaleString("en-US"), months);
}

/** `counted`: what the file holds when preflight doesn't count its rows (accounts files are read by the statement readers). */
export function PreflightSummary({ run, company, moduleLabel, counted }: { run: PreflightRun | null; company: string; moduleLabel: string; counted?: string }) {
  const w = useDict().wiz.sum;
  if (!run) return null;
  const t = preflightTotals(run);
  return (
    <div className="mb-4 max-w-4xl rounded-lg border border-line p-3 text-[13.5px]" data-testid="preflight-summary">
      <p className="font-medium">{w.title}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        <dt className="text-mute">{w.company}</dt><dd>{company}</dd>
        <dt className="text-mute">{w.import}</dt><dd>{moduleLabel}</dd>
        <dt className="text-mute">{w.sheets}</dt><dd>{t.sheets.map((s) => s.sheet).join(", ") || w.none}{t.leftOutSheets.length ? <span className="text-mute">{w.leftOut(t.leftOutSheets.map((s) => s.sheet).join(", "))}</span> : null}</dd>
        <dt className="text-mute">{counted ? w.inFile : w.rowsChecked}</dt><dd data-testid="preflight-summary-rows">{counted ?? w.rows(t.rows.toLocaleString("en-US"), t.skipped.toLocaleString("en-US"))}</dd>
      </dl>
      {t.changes.length > 0 && (
        <div className="mt-2"><p className="text-mute">{w.changes}</p><ul className="list-disc ps-5">{t.changes.map((c, i) => <li key={i}>{c.sheet}: {c.detail}</li>)}</ul></div>
      )}
      {t.warnings.length > 0 && (
        <div className="mt-2"><p className="text-mute">{w.warnings}</p><ul className="list-disc ps-5">{t.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}</ul></div>
      )}
      {t.skipped > 0 && <RejectedDownload run={run} />}
    </div>
  );
}

/** The rows that were not imported, with the reason for each, as a file the person can keep. */
export function RejectedDownload({ run, label }: { run: PreflightRun; label?: string }) {
  const w = useDict().wiz.sum;
  if (!run.cleaned.rejected.length) return null;
  return (
    <button className="mt-2 text-xs underline" data-testid="preflight-rejected-download" onClick={() => {
      const csv = toCsv({ name: "rejected", rows: [["Sheet", "Row", "Reason"], ...run.cleaned.rejected.map((r) => [r.sheet, r.row, r.reason])] });
      const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "rejected-rows.csv" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }}>{label ?? w.dlSkipped}</button>
  );
}
