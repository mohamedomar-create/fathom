import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { getUser } from "@/lib/supabase/server";
import { loadYearBudgets } from "@/lib/company/budget-load";
import { FinancialsPage } from "@/components/analysis/financials-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase } = await getUser();
  // Each financial year's budget for the "Budget" comparison: its latest approved version, else its latest draft.
  const budgets = await loadYearBudgets(supabase, id, { drafts: true });
  return <FinancialsPage budgets={budgets} />;
}
