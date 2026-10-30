import { notFound } from "next/navigation";
import { getDict } from "@/lib/i18n/server";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyBundle } from "@/lib/company/load";
import { checkKey, runChecks } from "@/lib/company/checks";
import { closeCandidates } from "@/lib/company/close";
import { isUuid } from "@/lib/ids";
import { MonthClose } from "@/components/settings/month-close";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const heading = (await getDict()).settingsNav.items["close"]?.[0] ?? "Month close";
  const b = await loadCompanyBundle(id);
  const { supabase } = await getUser();
  // The checks the books carry now, with those accepted at import marked (they don't stop a close).
  const { data: imp } = await supabase.from("imports").select("report").eq("company_id", id).eq("data_version", b.dataVersion).eq("action", "import").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const ok = new Set((((imp?.report ?? {}) as { accepted?: { key: string }[] }).accepted ?? []).map((a) => a.key));
  const checks = runChecks({ accounts: b.accounts, months: b.months, unit: b.unit }).map((c) => ({ id: c.id, severity: c.severity, period: c.period, title: c.title, accepted: ok.has(checkKey(c)) }));
  const { data: log } = await supabase.from("company_data_audit").select("action, scope, at").eq("company_id", id).in("action", ["close_month", "reopen_month"]).order("at", { ascending: false }).limit(20);
  const months = b.months.map((m) => m.period);
  return (
    <div>
      <div className="label">6 · {heading}</div>
      <h1 className="mb-6 text-3xl font-light">{heading}</h1>
      <MonthClose companyId={id} closedThrough={b.closedThrough ?? null} candidates={closeCandidates(months, b.closedThrough, b.asOf)} closedMonths={months.filter((p) => !!b.closedThrough && p <= b.closedThrough)}
        canClose={b.role === "admin" || b.role === "owner"} checks={checks} log={(log ?? []).map((l) => ({ action: l.action as "close_month" | "reopen_month", month: l.scope, at: l.at }))} />
    </div>
  );
}
