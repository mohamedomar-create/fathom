import { notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyMeta } from "@/lib/company/meta";
import { moduleByKey } from "@/lib/modules/registry";
import { ModulePage, type ModuleRow, type ModuleSummary } from "@/components/modules/module-page";
import { dbError } from "@/lib/action-error";

/** A module added by definition (kept in the shared store): its page, drawn from its summary and its latest rows. */
export default async function ModuleRoute({ params }: { params: Promise<{ id: string; module: string }> }) {
  const { id, module } = await params;
  const m = moduleByKey(module);
  if (!m || m.storage !== "generic") notFound();
  await loadCompanyMeta(id);
  const { supabase } = await getUser();
  const [{ data: c }, sum, page] = await Promise.all([
    supabase.from("companies").select("currency").eq("id", id).single(),
    supabase.rpc("module_summary", { p_company: id, p_module: m.key }),
    supabase.rpc("module_rows_page", { p_company: id, p_module: m.key, p_offset: 0, p_limit: 200 }),
  ]);
  if (sum.error) throw new Error(dbError(sum.error, "module_summary"));
  if (page.error) throw new Error(dbError(page.error, "module_rows_page"));
  return <ModulePage module={m.key} summary={sum.data as unknown as ModuleSummary} rows={(page.data ?? []) as unknown as ModuleRow[]} cur={c?.currency ?? "EGP"} base={`/company/${id}`} />;
}
export const maxDuration = 60;
