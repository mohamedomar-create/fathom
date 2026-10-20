import { CustomerNamesProvider } from "@/lib/company/sales-context";
import { customersOf } from "@/lib/engine";
import { loadSales } from "@/lib/company/sales-load";
import { ExpensesProvider } from "@/lib/company/expenses-context";
import { loadExpenses, noExpenses } from "@/lib/company/expenses-load";
import { ModuleGate, statusOf } from "@/components/shell/module-state";
import { hasFigures } from "@/lib/company/loaded";

export default async function ExpensesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The customers' names tell a customer from a supplier on a cost line (only the names go to the page, not the sales).
  const [expenses, sales] = await Promise.all([loadExpenses(id), loadSales(id)]);
  const names = hasFigures(sales) ? [...customersOf(sales.data)] : [];
  return (
    <ModuleGate module="expenses" state={statusOf(expenses, !noExpenses(expenses.data))}>
      <CustomerNamesProvider value={names}><ExpensesProvider value={expenses.data}>{children}</ExpensesProvider></CustomerNamesProvider>
    </ModuleGate>
  );
}
