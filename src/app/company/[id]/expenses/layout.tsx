import { SalesProvider } from "@/lib/company/sales-context";
import { loadSales } from "@/lib/company/sales-load";
import { ExpensesProvider } from "@/lib/company/expenses-context";
import { loadExpenses } from "@/lib/company/expenses-load";

export default async function ExpensesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Sales tell a customer from a supplier on a cost line.
  const [expenses, sales] = await Promise.all([loadExpenses(id), loadSales(id)]);
  return <SalesProvider value={sales}><ExpensesProvider value={expenses}>{children}</ExpensesProvider></SalesProvider>;
}
