import { ExpensesProvider } from "@/lib/company/expenses-context";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { InventoryProvider } from "@/lib/company/inventory-context";
import { demoInventory } from "@/lib/company/demo-inventory";

export default function DemoInventoryLayout({ children }: { children: React.ReactNode }) {
  return <ExpensesProvider value={demoExpenses()}><InventoryProvider value={demoInventory()}>{children}</InventoryProvider></ExpensesProvider>;
}
