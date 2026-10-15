import { loadCompanyBundle } from "@/lib/company/load";
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
import { loadInventory } from "@/lib/company/inventory-load";
import { loadExpenses } from "@/lib/company/expenses-load";

export default async function DataHealthPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ imported?: string }> }) {
  const { id } = await params;
  const { imported } = await searchParams;
  const { supabase } = await getUser();
  const bundle = await loadCompanyBundle(id);
  const [current, { data: imports }, { data: salesFiles }, { data: expenseFiles }, inventory, expenses] = await Promise.all([
    loadVersion(supabase, id, bundle.dataVersion),
    supabase.from("imports").select("id, kind, action, filename, created_at, created_by, data_version, report").eq("company_id", id).order("created_at", { ascending: false }).limit(40),
    supabase.from("sales_batches").select("id, filename, periods, created_at").eq("company_id", id).eq("source", "file").order("created_at", { ascending: false }).limit(40),
    supabase.from("expense_batches").select("id, filename, periods, created_at").eq("company_id", id).eq("source", "file").order("created_at", { ascending: false }).limit(40),
    loadInventory(id), loadExpenses(id),
  ]);
  // Sales and expenses files uploaded on their own (lines from a General Ledger belong to its import above).
  const lineUploads: LineUpload[] = [
    ...(salesFiles ?? []).map((b) => ({ id: b.id, kind: "sales" as const, file: b.filename, periods: (b.periods as string[] | null) ?? [], at: b.created_at })),
    ...(expenseFiles ?? []).map((b) => ({ id: b.id, kind: "expenses" as const, file: b.filename, periods: (b.periods as string[] | null) ?? [], at: b.created_at })),
  ].sort((a, b) => b.at.localeCompare(a.at)).flatMap((u, _i, all) => {
    // A newer file replaced the older one's months (their lines are gone): show each upload with the months it still holds.
    const newer = all.filter((x) => x.kind === u.kind && x.at > u.at).flatMap((x) => x.periods);
    const left = u.periods.filter((p) => !newer.includes(p));
    return left.length ? [{ ...u, periods: left }] : [];
  });
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
      <section className="mt-10">
        <h2 className="mb-3 text-lg font-medium">Sales and expenses files</h2>
        <LineUploads rows={lineUploads} companyId={id} readOnly={bundle.readOnly} />
      </section>
      <section className="mt-10"><ImportJobs companyId={id} /></section>
      <StockChecks inventory={inventory} expenses={expenses} />
    </div>
  );
}
