"use client";
import { createContext, useContext } from "react";
import { EMPTY_EXPENSES, type ExpensesData } from "@/lib/engine";

const Ctx = createContext<ExpensesData>(EMPTY_EXPENSES);

/** The company's expense summary for the Expenses pages (loaded once by the sector's layout). */
export function ExpensesProvider({ value, children }: { value: ExpensesData; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useExpenses = () => useContext(Ctx);
