import { ExpensesProvider } from "@/lib/company/expenses-context";
import { loadExpenses } from "@/lib/company/expenses-load";

export default async function ExpensesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExpensesProvider value={await loadExpenses(id)}>{children}</ExpensesProvider>;
}
