import { ExpensesProvider } from "@/lib/company/expenses-context";
import { loadExpenses, noExpenses } from "@/lib/company/expenses-load";
import { SalesProvider } from "@/lib/company/sales-context";
import { loadSales, noSales } from "@/lib/company/sales-load";
import { DependencyNote, UnreadModules } from "@/components/shell/module-state";
import { unknownState } from "@/lib/company/loaded";

/** Reports can include the Sales and Expenses pages, so they read the company's sales and expense lines too. */
export default async function ReportsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sales, expenses] = await Promise.all([loadSales(id), loadExpenses(id)]);
  const unread = [
    ...(unknownState(sales, (d) => noSales(d as typeof sales.data)) ? ["sales" as const] : []),
    ...(unknownState(expenses, (d) => noExpenses(d as typeof expenses.data)) ? ["expenses" as const] : []),
  ];
  return (
    <UnreadModules modules={unread}>
      <DependencyNote modules={unread} />
      <SalesProvider value={sales.data}><ExpensesProvider value={expenses.data}>{children}</ExpensesProvider></SalesProvider>
    </UnreadModules>
  );
}
