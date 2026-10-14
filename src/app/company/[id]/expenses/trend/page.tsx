import type { Metadata } from "next";
import { ExpensesTrend } from "@/components/expenses/expenses-trend";
export const metadata: Metadata = { title: "Expenses Trend" };
export default function Page() { return <ExpensesTrend />; }
