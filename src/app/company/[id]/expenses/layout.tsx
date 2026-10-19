import { CustomerNamesProvider } from "@/lib/company/sales-context";
import { customersOf } from "@/lib/engine";
import { loadSales } from "@/lib/company/sales-load";
import { ExpensesProvider } from "@/lib/company/expenses-context";
import { loadExpenses } from "@/lib/company/expenses-load";

export default async function ExpensesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // The customers' names tell a customer from a supplier on a cost line (only the names go to the page, not the sales).
  const [expenses, sales] = await Promise.all([loadExpenses(id), loadSales(id)]);
  return <CustomerNamesProvider value={[...customersOf(sales)]}><ExpensesProvider value={expenses}>{children}</ExpensesProvider></CustomerNamesProvider>;
}
