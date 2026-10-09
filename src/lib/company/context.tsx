"use client";
import { createContext, useContext } from "react";
import type { CompanyBundle } from "./types";

const Ctx = createContext<CompanyBundle | null>(null);

export function CompanyProvider({ value, children }: { value: CompanyBundle; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCompany(): CompanyBundle {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCompany outside CompanyProvider");
  return v;
}
