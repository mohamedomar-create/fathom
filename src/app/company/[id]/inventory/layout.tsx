import { ExpensesProvider } from "@/lib/company/expenses-context";
import { loadExpenses } from "@/lib/company/expenses-load";
import { InventoryProvider } from "@/lib/company/inventory-context";
import { loadInventory } from "@/lib/company/inventory-load";
import { forInventory } from "@/lib/engine/inventory";

export default async function InventoryLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The expense lines carry the cost of goods sold posted by stock moves: the ledger side of the cost-of-sales check. Only
  // that part is sent to the page.
  const [inventory, expenses] = await Promise.all([loadInventory(id), loadExpenses(id)]);
  return <ExpensesProvider value={forInventory(expenses)}><InventoryProvider state={inventory}>{children}</InventoryProvider></ExpensesProvider>;
}
