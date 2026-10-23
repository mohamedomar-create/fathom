"use client";
import { createContext, useContext } from "react";
import type { CashCompany, StoredEntry } from "./load";

export interface CashValue { company: CashCompany; entries: StoredEntry[] }
const Ctx = createContext<CashValue | null>(null);

/** The business and its entries, loaded once by the cash book's layout. */
export function CashProvider({ value, children }: { value: CashValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useCash(): CashValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCash outside the cash book");
  return v;
}
