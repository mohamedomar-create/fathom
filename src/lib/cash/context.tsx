"use client";
import { createContext, useContext } from "react";
import type { CashCompany, StoredEntry } from "./load";
import type { CategoryRule } from "./categorise";

export interface CashValue { company: CashCompany; entries: StoredEntry[]; /** Learned categories (0048), most recently used first. */ rules?: CategoryRule[] }
const Ctx = createContext<CashValue | null>(null);

/** The business and its entries, loaded once by the cash book's layout. */
export function CashProvider({ value, children }: { value: CashValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
/** The cash book's data when inside it, or null (the frame is drawn around pages that may have failed to load). */
export function useCashMaybe(): CashValue | null { return useContext(Ctx); }
export function useCash(): CashValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCash outside the cash book");
  return v;
}
