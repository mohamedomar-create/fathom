import { ExpensesProvider } from "@/lib/company/expenses-context";
import { demoExpenses } from "@/lib/company/demo-expenses";

export default function DemoExpensesLayout({ children }: { children: React.ReactNode }) {
  return <ExpensesProvider value={demoExpenses()}>{children}</ExpensesProvider>;
}
