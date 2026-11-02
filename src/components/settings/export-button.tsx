"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/use-t";
import { companySheets, slug, toXlsx, type CompanyExport } from "@/lib/export/company-workbook";

type Line = Record<string, unknown> & { id: number; period: string };

/**
 * Downloads the whole company: the figures first, then the sales and expense lines a page at a time, each a quick
 * request (no single request can run out of time on a large company), with the progress shown. The workbook is built
 * here in the browser, the same file the export address gives.
 */
export function ExportButton({ companyId, label }: { companyId: string; label: string }) {
  const T = useT();
  const ar = T.lang === "ar";
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const get = async (q: string) => {
    const r = await fetch(`/api/export/${companyId}/part?${q}`, { cache: "no-store" });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error ?? (ar ? "تعذر التصدير. حاول مرة أخرى." : "The export could not be made. Try again."));
    return body;
  };
  const lines = async (what: "sales" | "expenses", name: string) => {
    const out: Line[] = [];
    for (let after: number | null = 0; after !== null;) {
      setBusy(ar ? `${name}: ${out.length.toLocaleString("en-US")}…` : `${name}: ${out.length.toLocaleString("en-US")} lines…`);
      const p: { rows: Line[]; next: number | null } = await get(`what=${what}&after=${after}`);
      out.push(...p.rows);
      after = p.next;
    }
    return out.sort((a, b) => a.period.localeCompare(b.period) || a.id - b.id);
  };
  const go = async () => {
    setErr(null);
    try {
      setBusy(ar ? "الحسابات والإعدادات…" : "Accounts and settings…");
      const meta = await get("what=meta");
      const sales = await lines("sales", ar ? "المبيعات" : "Sales");
      const expenses = await lines("expenses", ar ? "المصروفات" : "Expenses");
      setBusy(ar ? "جارٍ إنشاء الملف…" : "Building the file…");
      const data = { ...meta, sales, expenses } as CompanyExport;
      const bytes = await toXlsx(companySheets(data, T.lang));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${slug(data.company.name)}-data-${data.exportedAt.slice(0, 10)}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(null); }
  };
  return (
    <div>
      <button type="button" onClick={go} disabled={!!busy} className="inline-block rounded border border-line px-4 py-2 text-sm hover:bg-band disabled:opacity-60" data-testid="export-company">{label}</button>
      {busy && <p className="mt-2 text-sm text-mute" role="status" data-testid="export-progress">{busy}</p>}
      {err && <p className="mt-2 text-sm text-red" role="alert">{err}</p>}
    </div>
  );
}
