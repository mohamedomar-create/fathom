"use client";
import { toCsv, type PreflightRun } from "@/lib/preflight";

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
export function PreflightSummary({ run, company, moduleLabel }: { run: PreflightRun | null; company: string; moduleLabel: string }) {
  if (!run) return null;
  const t = preflightTotals(run);
  return (
    <div className="mb-4 max-w-4xl rounded-lg border border-line p-3 text-[13.5px]" data-testid="preflight-summary">
      <p className="font-medium">Before you confirm</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
        <dt className="text-mute">Company</dt><dd>{company}</dd>
        <dt className="text-mute">Import</dt><dd>{moduleLabel}</dd>
        <dt className="text-mute">Sheets</dt><dd>{t.sheets.map((s) => s.sheet).join(", ") || "none"}{t.leftOutSheets.length ? <span className="text-mute"> (left out: {t.leftOutSheets.map((s) => s.sheet).join(", ")})</span> : null}</dd>
        <dt className="text-mute">Rows checked</dt><dd data-testid="preflight-summary-rows">{t.rows.toLocaleString("en-US")} to import · {t.skipped.toLocaleString("en-US")} skipped</dd>
      </dl>
      {t.changes.length > 0 && (
        <div className="mt-2"><p className="text-mute">Changes made in the cleaned copy:</p><ul className="list-disc ps-5">{t.changes.map((c, i) => <li key={i}>{c.sheet}: {c.detail}</li>)}</ul></div>
      )}
      {t.warnings.length > 0 && (
        <div className="mt-2"><p className="text-mute">Warnings:</p><ul className="list-disc ps-5">{t.warnings.slice(0, 10).map((w, i) => <li key={i}>{w}</li>)}</ul></div>
      )}
      {t.skipped > 0 && <RejectedDownload run={run} />}
    </div>
  );
}

/** The rows that were not imported, with the reason for each, as a file the person can keep. */
export function RejectedDownload({ run, label = "Download the skipped rows (.csv)" }: { run: PreflightRun; label?: string }) {
  if (!run.cleaned.rejected.length) return null;
  return (
    <button className="mt-2 text-xs underline" data-testid="preflight-rejected-download" onClick={() => {
      const csv = toCsv({ name: "rejected", rows: [["Sheet", "Row", "Reason"], ...run.cleaned.rejected.map((r) => [r.sheet, r.row, r.reason])] });
      const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "rejected-rows.csv" });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }}>{label}</button>
  );
}
