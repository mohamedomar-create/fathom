"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { useT } from "@/lib/i18n/use-t";
import type { Sheet } from "@/lib/export/company-workbook";
import { diffSheets, type DiffRow } from "@/lib/export/diff-list";

/** Arabic labels for a difference list's workbook. */
const AR = { month: "الشهر", account: "الحساب", books: "الدفاتر", file: "الملف", difference: "الفرق", months: "الأشهر", list: "الفروق", summary: "ملخص حسب الحساب" };

/** "Download all (xlsx)": every row of a list the page shows only in part, built in the browser. */
export function DownloadAll({ name, sheets, testId = "download-all", total }: { name: string; sheets: () => Sheet[]; testId?: string; total?: number }) {
  const T = useT();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { toXlsx } = await import("@/lib/export/company-workbook");
      const bytes = await toXlsx(sheets());
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally { setBusy(false); }
  };
  const label = T.lang === "ar" ? `نزّل الكل (xlsx)${total ? ` · ${total}` : ""}` : `Download all (xlsx)${total ? ` · ${total} rows` : ""}`;
  return (
    <button type="button" onClick={go} disabled={busy} className="inline-flex items-center gap-1.5 rounded border border-brand-d px-2.5 py-1 text-xs text-brand-d hover:bg-brand-bg disabled:opacity-60" data-testid={testId}>
      <Download className="h-3.5 w-3.5" />{label}
    </button>
  );
}

/** The same for a list of differences (month, account, books, file): every row and a summary by account. */
export function DownloadDiffs({ name, rows, testId, labels }: { name: string; rows: DiffRow[]; testId?: string; labels?: Partial<typeof AR> }) {
  const T = useT();
  return <DownloadAll name={name} total={rows.length} testId={testId} sheets={() => diffSheets(rows, T.lang === "ar" ? { ...AR, ...labels } : { month: "Month", account: "Account", books: "Books", file: "File", difference: "Difference", months: "Months", list: "Differences", summary: "Summary by account", ...labels })} />;
}
