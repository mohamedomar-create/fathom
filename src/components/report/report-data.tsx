import { ExpensesProvider } from "@/lib/company/expenses-context";
import { loadExpenses, noExpenses } from "@/lib/company/expenses-load";
import { SalesProvider } from "@/lib/company/sales-context";
import { loadSales, noSales } from "@/lib/company/sales-load";
import { DependencyNote, UnreadModules } from "@/components/shell/module-state";
import { unknownState } from "@/lib/company/loaded";

/**
 * A report can include the Sales and Expenses pages, so an open report reads the company's sales and expense summaries
 * (the list of reports does not: it stays light). A module that couldn't be read is named, never shown as empty.
 */
export async function ReportData({ id, children }: { id: string; children: React.ReactNode }) {
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
