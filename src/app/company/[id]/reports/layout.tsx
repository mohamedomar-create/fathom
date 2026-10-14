import { ExpensesProvider } from "@/lib/company/expenses-context";
import { loadExpenses } from "@/lib/company/expenses-load";
import { SalesProvider } from "@/lib/company/sales-context";
import { loadSales } from "@/lib/company/sales-load";

/** Reports can include the Sales and Expenses pages, so they read the company's sales and expense lines too. */
export default async function ReportsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sales, expenses] = await Promise.all([loadSales(id), loadExpenses(id)]);
  return <SalesProvider value={sales}><ExpensesProvider value={expenses}>{children}</ExpensesProvider></SalesProvider>;
}
