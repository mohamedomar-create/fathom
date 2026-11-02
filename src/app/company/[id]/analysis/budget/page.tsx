import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { getUser } from "@/lib/supabase/server";
import { loadBudgets } from "@/lib/company/budget-load";
import { loadSales } from "@/lib/company/sales-load";
import { BudgetPage } from "@/components/analysis/budget-page";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { v } = await searchParams;
  const { supabase } = await getUser();
  const [set, sales] = await Promise.all([loadBudgets(supabase, id, v && isUuid(v) ? v : null), loadSales(id)]);
  return <BudgetPage versions={set.versions} current={set.current} salesProducts={sales.data.products} />;
}
