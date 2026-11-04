"use client";
import { createContext, useContext, useMemo } from "react";
import { unpack, type Packed } from "@/lib/wire/pack";
import { EMPTY_EXPENSES, type ExpensesData } from "@/lib/engine";

const Ctx = createContext<ExpensesData>(EMPTY_EXPENSES);

/** The company's expense summary for the Expenses pages (loaded once by the sector's layout). */
export function ExpensesProvider({ value, children }: { value: ExpensesData | Packed; children: React.ReactNode }) {
  // Sent compact (lib/wire/pack); read back once here.
  const data = useMemo(() => unpack<ExpensesData>(value), [value]);
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export const useExpenses = () => useContext(Ctx);
