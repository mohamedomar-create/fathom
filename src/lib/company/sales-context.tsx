"use client";
import { createContext, useContext } from "react";
import { EMPTY_SALES, type SalesData } from "@/lib/engine";

const Ctx = createContext<SalesData>(EMPTY_SALES);

/** The company's sales summary for the Sales pages (loaded once by the sector's layout). */
export function SalesProvider({ value, children }: { value: SalesData; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSales = () => useContext(Ctx);

const Names = createContext<string[]>([]);
/** Only the names of the company's customers (the Expenses pages tell a customer from a supplier with them). */
export function CustomerNamesProvider({ value, children }: { value: string[]; children: React.ReactNode }) {
  return <Names.Provider value={value}>{children}</Names.Provider>;
}
export const useCustomerNames = () => useContext(Names);
