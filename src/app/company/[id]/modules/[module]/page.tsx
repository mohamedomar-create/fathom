import { notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyBundle } from "@/lib/company/load";
import { moduleByKey } from "@/lib/modules/registry";
import { ModulePage, type ModuleRow, type ModuleSummary } from "@/components/modules/module-page";
import { dbError } from "@/lib/action-error";
import { windowFor } from "@/lib/engine/period";
import type { PeriodType } from "@/lib/engine";
import type { ModuleSpec } from "@/lib/modules/spec";
import { specToDef } from "@/lib/modules/spec";
import { isOn } from "@/lib/modules/company";
import { moduleEnd, snapshotRange } from "@/lib/modules/view";

const FIELD = /^[a-z][a-z0-9_]{0,39}$/;

/** A module kept in the shared store (catalog, custom or Purchasing): its page, filtered by its own months and fields. */
export default async function ModuleRoute({ params, searchParams }: { params: Promise<{ id: string; module: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id, module } = await params;
  const sp = await searchParams;
  const c = await loadCompanyBundle(id);
  const row = (c.modules ?? []).find((r) => r.key === module);
  // The company's own module comes from its stored definition; the catalog and built-in ones from the registry.
  let spec: ModuleSpec | null = null;
  let m = moduleByKey(module);
  if (!m && module.startsWith("c_") && row?.kind === "custom" && row.spec) {
    try { spec = { ...(row.spec as ModuleSpec), key: module }; m = specToDef(spec); } catch { m = null; }
  }
  if (!m || m.storage !== "generic") notFound();
  const opened = isOn(module, c.modules ?? []);
  // Filters: ?f.<field>=value (any field the module groups by), ?q= search, and the period in the URL.
  const dims = (m.dimensions ?? []).filter((k) => FIELD.test(k));
  const filters: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (!k.startsWith("f.")) continue;
    const f = k.slice(2);
    if (FIELD.test(f) && (dims.includes(f) || f === "partner")) filters[f] = (Array.isArray(v) ? v : [v ?? ""]).filter(Boolean).slice(0, 20);
  }
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const { supabase } = await getUser();
  // The period: the URL's month when the module holds it, else its latest month, exactly as the page's own period picker
  // reads it (a foreign or bad ?end= never gives the server one window and the page another).
  const first = await supabase.rpc("module_summary", { p_company: id, p_module: m.key, p_filters: filters });
  if (first.error?.code === "42501") return <ModulePage module={m.key} spec={spec} summary={null} rows={[]} base={`/company/${id}`} opened={opened} filters={filters} q={q} denied />;
  const own = ((first.data as { periods?: { period: string }[] } | null)?.periods ?? []).map((p) => p.period);
  const end = moduleEnd(own, typeof sp.end === "string" ? sp.end : null);
  const type = (["month", "quarter", "year"].includes(String(sp.type)) ? sp.type : "month") as PeriodType;
  const win = end ? windowFor({ type, end }, c.settings.fyStartMonth) : null;
  // A snapshot (headcount, asset register) is read at the latest month it holds in the window, never added up.
  const w = win ? snapshotRange(win.periods, own, m.nature ?? "flow") : null;
  const [sum, page] = await Promise.all([
    supabase.rpc("module_summary", { p_company: id, p_module: m.key, p_from: w?.from ?? null, p_to: w?.to ?? null, p_filters: filters, p_dims: dims, p_measures: (m.measures ?? []).filter((k) => FIELD.test(k)) }),
    supabase.rpc("module_rows_page", { p_company: id, p_module: m.key, p_offset: 0, p_limit: 200, p_from: w?.from ?? null, p_to: w?.to ?? null, p_filters: filters, p_search: q || null }),
  ]);
  // A module the person may not see answers "not allowed": said so, never shown as empty.
  if (sum.error?.code === "42501") return <ModulePage module={m.key} spec={spec} summary={null} rows={[]} base={`/company/${id}`} opened={opened} filters={filters} q={q} denied />;
  if (sum.error) throw new Error(dbError(sum.error, "module_summary"));
  if (page.error) throw new Error(dbError(page.error, "module_rows_page"));
  return <ModulePage module={m.key} spec={spec} summary={sum.data as unknown as ModuleSummary} rows={(page.data ?? []) as unknown as ModuleRow[]} base={`/company/${id}`} opened={opened} filters={filters} q={q} />;
}
export const maxDuration = 60;
