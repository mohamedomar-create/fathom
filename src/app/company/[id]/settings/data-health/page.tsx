import { loadCompanyBundle } from "@/lib/company/load";
import { compareBooks, type BookDiff } from "@/lib/company/compare";
import { compareWithOf } from "@/lib/company/time-zone";
import { CLASS_LABEL } from "@/lib/ingest/classes";
import type { ClassKey } from "@/lib/engine";
import { loadVersion, KEEP_VERSIONS } from "@/lib/company/persist";
import { checkKey, coverageOf, runChecks } from "@/lib/company/checks";
import { statementOf } from "@/lib/company/import-plan";
import { getUser } from "@/lib/supabase/server";
import { DataHealth, type HistoryRow, type MonthSource } from "@/components/settings/data-health";
import type { FixRecord } from "@/lib/ingest/trace";
import type { AcceptedItem } from "../actions";
import { ImportReadiness } from "@/components/setup/import-readiness";
import { LineUploads, type LineUpload } from "@/components/settings/line-uploads";
import { StockChecks } from "@/components/inventory/stock-checks";
import { ImportJobs } from "@/components/imports/import-jobs";
import { ExportLayouts, type LayoutRow } from "@/components/settings/export-layouts";
import { loadInventory } from "@/lib/company/inventory-load";
import { loadExpenses } from "@/lib/company/expenses-load";

export default async function DataHealthPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ imported?: string }> }) {
  const { id } = await params;
  const { imported } = await searchParams;
  const { supabase } = await getUser();
  const bundle = await loadCompanyBundle(id);
  const [current, { data: imports }, { data: salesFiles }, { data: expenseFiles }, inventory, expenses, { data: profiles }, { data: paymentFiles }, { data: agedFiles }] = await Promise.all([
    loadVersion(supabase, id, bundle.dataVersion),
    supabase.from("imports").select("id, kind, action, filename, created_at, created_by, data_version, report").eq("company_id", id).order("created_at", { ascending: false }).limit(40),
    supabase.from("sales_batches").select("id, filename, periods, created_at").eq("company_id", id).eq("source", "file").order("created_at", { ascending: false }).limit(40),
    supabase.from("expense_batches").select("id, filename, periods, created_at").eq("company_id", id).eq("source", "file").order("created_at", { ascending: false }).limit(40),
    loadInventory(id), loadExpenses(id),
    supabase.from("input_profiles").select("kind, sheet, headings, read, ignored, history, updated_at").eq("company_id", id).order("kind"),
    // Payments uploads and ageing reports (none before the database has the Payments tables).
    supabase.from("payment_batches").select("id, filename, periods, created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(40),
    supabase.from("aged_reports").select("id, side, as_of, filename, created_at").eq("company_id", id).order("created_at", { ascending: false }).limit(40),
  ]);
  // Each export's remembered layout (none before the database has the table).
  const layouts: LayoutRow[] = (profiles ?? []).map((p) => ({
    kind: p.kind, sheet: p.sheet, headings: p.headings, read: p.read, ignored: p.ignored, updatedAt: p.updated_at,
    earlier: (Array.isArray(p.history) ? p.history : []).map((h) => h as { headings?: string[]; until?: string }).filter((h) => h.headings && h.until).map((h) => ({ headings: h.headings!, until: h.until! })),
  }));
  // Sales and expenses files uploaded on their own (lines from a General Ledger belong to its import above).
  const lineUploads: LineUpload[] = [
    ...(salesFiles ?? []).map((b) => ({ id: b.id, kind: "sales" as const, file: b.filename, periods: (b.periods as string[] | null) ?? [], at: b.created_at })),
    ...(expenseFiles ?? []).map((b) => ({ id: b.id, kind: "expenses" as const, file: b.filename, periods: (b.periods as string[] | null) ?? [], at: b.created_at })),
    ...(paymentFiles ?? []).map((b) => ({ id: b.id, kind: "payments" as const, file: b.filename, periods: b.periods ?? [], at: b.created_at })),
  ].sort((a, b) => b.at.localeCompare(a.at)).flatMap((u, _i, all): LineUpload[] => {
    // A newer file replaced the older one's months (their lines are gone): show each upload with the months it still holds.
    const newer = all.filter((x) => x.kind === u.kind && x.at > u.at).flatMap((x) => x.periods);
    const left = u.periods.filter((p) => !newer.includes(p));
    return left.length ? [{ ...u, periods: left }] : [];
  }).concat((agedFiles ?? []).map((r) => ({ id: r.id, kind: "aged" as const, file: r.filename, periods: [r.as_of.slice(0, 7)], at: r.created_at, asOf: r.as_of, side: r.side as "receivable" | "payable" })))
    .sort((a, b) => b.at.localeCompare(a.at));
  const rows = imports ?? [];
  const people = new Map<string, string>();
  const ids = [...new Set(rows.map((r) => r.created_by).filter(Boolean) as string[])];
  if (ids.length) {
    const { data: ps } = await supabase.from("profiles").select("id, email, full_name").in("id", ids);
    for (const p of ps ?? []) people.set(p.id, p.full_name || p.email);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Which import supplied each statement-month of the current data.
  const sources: Record<string, MonthSource[]> = {};
  for (const a of current) for (const [p, imp] of Object.entries(a.sources ?? {})) {
    const k = `${statementOf(a.cls)}|${p}`;
    const list = (sources[k] ??= []);
    if (!list.some((s) => s.importId === imp)) {
      const r = imp ? byId.get(imp) : undefined;
      list.push({ importId: imp, file: r ? r.filename ?? (r.kind === "odoo" ? "Odoo sync" : "Upload") : "Earlier import", at: r?.created_at ?? null, by: r?.created_by ? people.get(r.created_by) ?? null : null });
    }
  }

  // A company that took its settings from another (its uploads of the same books) is compared with it, class by class.
  const compareId = compareWithOf((await supabase.from("companies").select("kpi_config").eq("id", id).maybeSingle()).data?.kpi_config);
  let comparison: { name: string; months: string[]; diffs: BookDiff[] } | null = null;
  if (compareId) {
    const { data: other } = await supabase.from("companies").select("name, data_version").eq("id", compareId).maybeSingle();
    if (other) comparison = { name: other.name, ...compareBooks(current, await loadVersion(supabase, compareId, other.data_version)) };
  }

  const currentImport = rows.find((r) => r.data_version === bundle.dataVersion && r.action === "import");
  const accepted = (((currentImport?.report ?? {}) as { accepted?: AcceptedItem[] }).accepted ?? []);
  const acceptedKeys = new Set(accepted.map((a) => a.key));
  const checks = runChecks({ accounts: bundle.accounts, months: bundle.months }).map((c) => (acceptedKeys.has(checkKey(c)) ? { ...c, accepted: true } : c));

  const cov = coverageOf(bundle.accounts);
  const maxVersion = Math.max(bundle.dataVersion, ...rows.map((r) => r.data_version ?? 0));
  const history: HistoryRow[] = rows.map((r) => {
    const rep = (r.report ?? {}) as { mode?: string; periods?: string[]; slices?: { PL?: string[]; BS?: string[] }; accepted?: AcceptedItem[]; restored_from?: number; restored_to?: number; checks?: { severity: string }[]; fixes?: FixRecord[] };
    return {
      id: r.id, kind: r.kind, action: r.action, file: r.filename, at: r.created_at, by: r.created_by ? people.get(r.created_by) ?? null : null,
      version: r.data_version, current: r.data_version === bundle.dataVersion && r.action === "import",
      restorable: r.action === "import" && r.data_version !== null && r.data_version !== bundle.dataVersion && r.data_version > maxVersion - KEEP_VERSIONS,
      mode: rep.mode ?? (r.action === "restore" ? null : "replace"),
      pl: rep.slices?.PL ?? (rep.mode ? [] : rep.periods ?? []), bs: rep.slices?.BS ?? (rep.mode ? [] : rep.periods ?? []),
      accepted: rep.accepted?.length ?? 0, restoredFrom: rep.restored_from ?? null, restoredTo: rep.restored_to ?? null,
      fixes: Array.isArray(rep.fixes) ? rep.fixes.slice(0, 100) : [],
    };
  });

  return (
    <div>
      <div className="label">3 · Data Health</div>
      <h1 className="mb-1 text-3xl font-light">Data health</h1>
      <p className="mb-6 text-mute">Which months are loaded, where each one came from, and whether the accounting checks pass.</p>
      {imported === "1" && <ImportReadiness />}
      <DataHealth
        companyId={id} readOnly={bundle.readOnly} justImported={imported === "1"}
        coverage={{ range: cov.range, pl: [...cov.pl], bs: [...cov.bs] }}
        checks={checks} accepted={accepted} sources={sources} history={history}
      />
      {comparison && (
        <section className="mt-10" data-testid="compare-books">
          <h2 className="mb-1 text-lg font-medium">Compared with {comparison.name}</h2>
          <p className="mb-3 text-sm text-mute">{comparison.months.length ? `${comparison.months.length} months both companies hold, class by class. ${comparison.diffs.length ? `${comparison.diffs.length} difference${comparison.diffs.length > 1 ? "s" : ""} above 1 EGP, largest first.` : "Every class agrees within 1 EGP."}` : "The two companies hold no month in common yet."}</p>
          {comparison.diffs.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-mute"><th className="py-1">Month</th><th>Class</th><th className="text-right">Here</th><th className="text-right">{comparison.name}</th><th className="text-right">Difference</th></tr></thead>
              <tbody>{comparison.diffs.slice(0, 40).map((d) => (
                <tr key={`${d.period}|${d.cls}`} className="border-t border-line"><td className="py-1">{d.period}</td><td>{CLASS_LABEL[d.cls as ClassKey] ?? d.cls}</td><td className="text-right tabular-nums">{Math.round(d.here).toLocaleString("en-GB")}</td><td className="text-right tabular-nums">{Math.round(d.there).toLocaleString("en-GB")}</td><td className="text-right tabular-nums">{Math.round(d.diff).toLocaleString("en-GB")}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>
      )}
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-medium">Sales and expenses files</h2>
        <LineUploads rows={lineUploads} companyId={id} readOnly={bundle.readOnly} />
      </section>
      <section className="mt-10">
        <h2 className="mb-1 text-lg font-medium">Your Odoo export layouts</h2>
        <p className="mb-3 text-sm text-mute">Every company’s Odoo exports its own columns. Each export’s layout is remembered on its first upload; an upload whose columns change stops until you confirm how it was read.</p>
        <ExportLayouts rows={layouts} />
      </section>
      <section className="mt-10"><ImportJobs companyId={id} /></section>
      <StockChecks inventory={inventory} expenses={expenses} />
    </div>
  );
}
