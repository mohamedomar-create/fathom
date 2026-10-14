import type { Metadata } from "next";
import { ExpensesOverview } from "@/components/expenses/expenses-overview";
export const metadata: Metadata = { title: "Expenses Overview" };
export default function Page() { return <ExpensesOverview />; }
