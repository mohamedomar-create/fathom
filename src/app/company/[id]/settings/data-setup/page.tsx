import { DataSetup } from "@/components/setup/data-setup";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { loadInventory } from "@/lib/company/inventory-load";
import { loadPayments } from "@/lib/company/payments-load";

export default async function DataSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sales, expenses, inventory, payments] = await Promise.all([loadSales(id), loadExpenses(id), loadInventory(id), loadPayments(id)]);
  return <DataSetup sales={sales} expenses={expenses} inventory={inventory} payments={payments} />;
}
