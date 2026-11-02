import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { getUser } from "@/lib/supabase/server";
import { loadBudgets } from "@/lib/company/budget-load";
import { FinancialsPage } from "@/components/analysis/financials-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase } = await getUser();
  // The budget for the "Budget" comparison: the latest approved version, else the latest draft (a read failure: none).
  const set = await loadBudgets(supabase, id);
  const v = set.versions.find((x) => x.id === set.current?.id);
  return <FinancialsPage budget={v && set.current ? { name: v.name, status: v.status, lines: set.current.lines, products: set.current.products } : null} />;
}
