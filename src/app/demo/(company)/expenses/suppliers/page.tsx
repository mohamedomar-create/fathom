import type { Metadata } from "next";
import { ExpensesSuppliers } from "@/components/expenses/expenses-suppliers";
export const metadata: Metadata = { title: "Suppliers" };
export default function Page() { return <ExpensesSuppliers />; }
