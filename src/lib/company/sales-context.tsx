"use client";
import { createContext, useContext, useMemo } from "react";
import { unpack, type Packed } from "@/lib/wire/pack";
import { EMPTY_SALES, type SalesData } from "@/lib/engine";

const Ctx = createContext<SalesData>(EMPTY_SALES);

/** The company's sales summary for the Sales pages (loaded once by the sector's layout). */
export function SalesProvider({ value, children }: { value: SalesData | Packed; children: React.ReactNode }) {
  // Sent compact (lib/wire/pack); read back once here.
  const data = useMemo(() => unpack<SalesData>(value), [value]);
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export const useSales = () => useContext(Ctx);

const Names = createContext<string[]>([]);
/** Only the names of the company's customers (the Expenses pages tell a customer from a supplier with them). */
export function CustomerNamesProvider({ value, children }: { value: string[]; children: React.ReactNode }) {
  return <Names.Provider value={value}>{children}</Names.Provider>;
}
export const useCustomerNames = () => useContext(Names);
