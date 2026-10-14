import { SalesProvider } from "@/lib/company/sales-context";
import { demoSales } from "@/lib/company/demo-sales";
import { ExpensesProvider } from "@/lib/company/expenses-context";
import { demoExpenses } from "@/lib/company/demo-expenses";

export default function DemoExpensesLayout({ children }: { children: React.ReactNode }) {
  return <SalesProvider value={demoSales()}><ExpensesProvider value={demoExpenses()}>{children}</ExpensesProvider></SalesProvider>;
}
