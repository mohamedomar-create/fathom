import { getUser } from "@/lib/supabase/server";
import { loadCompanyMeta } from "@/lib/company/meta";
import { getDict } from "@/lib/i18n/server";
import { SmartIntake } from "@/components/intake/smart-intake";
import type { SavedLayouts } from "@/lib/intake/memory";

/** Smart upload: any workbook, every tab placed in its module, checked and previewed before it is saved. */
export default async function IntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = (await getDict()).ink;
  const { supabase } = await getUser();
  const { role } = await loadCompanyMeta(id);
  const [{ data: c }, { data: layouts }] = await Promise.all([
    supabase.from("companies").select("currency").eq("id", id).single(),
    supabase.from("import_templates").select("export_key, mapping").eq("company_id", id).like("export_key", "intake:%"),
  ]);
  const saved: SavedLayouts = Object.fromEntries((layouts ?? []).map((l) => [l.export_key, (l.mapping ?? {}) as Record<string, string>]));
  if (role === "viewer") return <p className="rounded bg-band px-4 py-3 text-sm" data-testid="view-only">{t.viewOnly}</p>;
  return <SmartIntake companyId={id} currency={c?.currency ?? "EGP"} saved={saved} base={`/company/${id}`} />;
}
export const maxDuration = 60;
