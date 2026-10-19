import { getUser } from "@/lib/supabase/server";
import { loadCompanyBundle } from "@/lib/company/load";
import { loadDataFacts } from "@/lib/company/data-facts";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { loadInventory } from "@/lib/company/inventory-load";
import { loadPayments } from "@/lib/company/payments-load";
import { DataSteps } from "@/components/data/data-steps";
import { ReadinessOverview } from "@/components/setup/readiness-overview";

export default async function DataStepsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const { dataVersion } = await loadCompanyBundle(id);
  const [facts, sales, expenses, inventory, payments] = await Promise.all([loadDataFacts(supabase, id, dataVersion), loadSales(id), loadExpenses(id), loadInventory(id), loadPayments(id)]);
  return (
    <>
      <DataSteps facts={facts} sales={sales} expenses={expenses} inventory={inventory} payments={payments} />
      <ReadinessOverview sales={sales} expenses={expenses} inventory={inventory} payments={payments} />
    </>
  );
}
export const maxDuration = 60;
