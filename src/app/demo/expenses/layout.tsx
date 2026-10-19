import { CustomerNamesProvider } from "@/lib/company/sales-context";
import { customersOf } from "@/lib/engine";
import { demoSales } from "@/lib/company/demo-sales";
import { ExpensesProvider } from "@/lib/company/expenses-context";
import { demoExpenses } from "@/lib/company/demo-expenses";

export default function DemoExpensesLayout({ children }: { children: React.ReactNode }) {
  return <CustomerNamesProvider value={[...customersOf(demoSales())]}><ExpensesProvider value={demoExpenses()}>{children}</ExpensesProvider></CustomerNamesProvider>;
}
