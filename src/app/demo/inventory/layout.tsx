import { ExpensesProvider } from "@/lib/company/expenses-context";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { InventoryProvider } from "@/lib/company/inventory-context";
import { demoInventoryState } from "@/lib/company/demo-inventory";

export default function DemoInventoryLayout({ children }: { children: React.ReactNode }) {
  return <ExpensesProvider value={demoExpenses()}><InventoryProvider state={demoInventoryState()}>{children}</InventoryProvider></ExpensesProvider>;
}
