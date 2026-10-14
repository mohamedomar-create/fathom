import type { Metadata } from "next";
import { ExpensesAccounts } from "@/components/expenses/expenses-accounts";
export const metadata: Metadata = { title: "Expenses by Account" };
export default function Page() { return <ExpensesAccounts />; }
