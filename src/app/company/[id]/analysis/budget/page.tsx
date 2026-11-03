import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { getUser } from "@/lib/supabase/server";
import { loadBudgets, loadBudgetSetup } from "@/lib/company/budget-load";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { BudgetPage } from "@/components/analysis/budget-page";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { v } = await searchParams;
  const { supabase } = await getUser();
  const [set, sales, expenses, setup, company] = await Promise.all([
    loadBudgets(supabase, id, v && isUuid(v) ? v : null), loadSales(id), loadExpenses(id), loadBudgetSetup(supabase, id),
    supabase.from("companies").select("fy_start_month").eq("id", id).maybeSingle(),
  ]);
  return <BudgetPage versions={set.versions} current={set.current} salesProducts={sales.data.products} setup={setup} salesCustomers={sales.data.customers} expenseAccounts={expenses.data.accounts} fyStart={company.data?.fy_start_month ?? 1} />;
}
