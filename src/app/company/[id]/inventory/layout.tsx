import { ExpensesProvider } from "@/lib/company/expenses-context";
import { loadExpenses } from "@/lib/company/expenses-load";
import { InventoryProvider } from "@/lib/company/inventory-context";
import { loadInventory } from "@/lib/company/inventory-load";
import { forInventory } from "@/lib/engine/inventory";
import { DependencyNote, UnreadModules } from "@/components/shell/module-state";
import { unknownState } from "@/lib/company/loaded";
import { noExpenses } from "@/lib/company/expenses-load";

export default async function InventoryLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The expense lines carry the cost of goods sold posted by stock moves: the ledger side of the cost-of-sales check. Only
  // that part is sent to the page. When they could not be read, the page says so rather than reporting "no ledger".
  const [inventory, expenses] = await Promise.all([loadInventory(id), loadExpenses(id)]);
  const unread = unknownState(expenses, (d) => noExpenses(d as typeof expenses.data)) ? ["expenses" as const] : [];
  return (
    <UnreadModules modules={unread}>
      <DependencyNote modules={unread} />
      <ExpensesProvider value={forInventory(expenses.data)}><InventoryProvider state={inventory}>{children}</InventoryProvider></ExpensesProvider>
    </UnreadModules>
  );
}
