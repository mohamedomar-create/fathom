import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { loadInventory } from "@/lib/company/inventory-load";
import { loadPayments } from "@/lib/company/payments-load";
import { ReadinessOverview } from "@/components/setup/readiness-overview";

export default async function DataReadinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sales, expenses, inventory, payments] = await Promise.all([loadSales(id), loadExpenses(id), loadInventory(id), loadPayments(id)]);
  return <ReadinessOverview sales={sales} expenses={expenses} inventory={inventory} payments={payments} />;
}
export const maxDuration = 60;
