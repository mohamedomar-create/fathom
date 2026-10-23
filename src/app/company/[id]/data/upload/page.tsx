import { getUser } from "@/lib/supabase/server";
import { booksStartOf } from "@/lib/company/time-zone";
import { loadCompanyMeta } from "@/lib/company/meta";
import { UploadWizard } from "@/components/settings/upload-wizard";
import { loadAccountMap } from "@/lib/company/account-map";
import { loadDataFacts } from "@/lib/company/data-facts";

export default async function DataUploadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const { id } = await params;
  const { step } = await searchParams;
  const { supabase } = await getUser();
  // The role and current version only (the figures themselves are not shown here); everything else in one round.
  const { role, dataVersion } = await loadCompanyMeta(id);
  const [{ data: c }, { data: imports }, { data: batches }, { data: expBatches }, facts, accountMap, { data: profiles }] = await Promise.all([
    supabase.from("companies").select("currency, fy_start_month, data_version, last_synced_at, source, kpi_config").eq("id", id).single(),
    supabase.from("imports").select("id, kind, report").eq("company_id", id).eq("kind", "upload").eq("action", "import").order("created_at", { ascending: false }).limit(1),
    supabase.from("sales_batches").select("periods").eq("company_id", id).eq("source", "file"),
    supabase.from("expense_batches").select("periods").eq("company_id", id).eq("source", "file"),
    loadDataFacts(supabase, id, dataVersion),
    loadAccountMap(supabase, id),
    supabase.from("input_profiles").select("kind, headings").eq("company_id", id),
  ]);
  // Months that already have sales from a file: a new sales file asks before replacing them.
  const salesLoaded = [...new Set((batches ?? []).flatMap((b) => (b.periods as string[] | null) ?? []))].sort();
  const expensesLoaded = [...new Set((expBatches ?? []).flatMap((b) => (b.periods as string[] | null) ?? []))].sort();
  const lastUpload = imports?.find((i) => i.kind === "upload");
  // The company's account map (every class a person has chosen); before it existed, the last upload's mapping.
  // The company's remembered export layouts (none before the database has them).
  const savedLayouts = Object.fromEntries((profiles ?? []).map((p) => [p.kind, p.headings]));
  const savedMapping = Object.keys(accountMap).length ? accountMap : ((lastUpload?.report as { mapping?: Record<string, string> } | null)?.mapping) ?? {};
  const steps = ["opening", "financials", "tb", "sales", "expenses", "inventory", "payments"] as const;
  const setupStep = steps.find((x) => x === step);
  return (
    <div>
      <p className="mb-5 text-mute">Nothing is saved until you press Save. Undo an upload under Checks &amp; history.</p>
      {role === "viewer" ? (
        <p className="rounded bg-band px-4 py-3 text-sm" data-testid="view-only">You have view-only access to this company, so you cannot import data. Ask an admin of the organisation for editor access.</p>
      ) : c && <UploadWizard key={step ?? "any"} companyId={id} currency={c.currency} fyStart={c.fy_start_month} savedMapping={savedMapping} savedLayouts={savedLayouts} hasData={c.data_version > 0} setupStep={setupStep} salesLoaded={salesLoaded} expensesLoaded={expensesLoaded} booksStart={booksStartOf(c.kpi_config)} ledgerLoaded={facts.ledger} />}
    </div>
  );
}
export const maxDuration = 60;
