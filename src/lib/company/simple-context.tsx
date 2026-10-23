"use client";
import { createContext, useContext } from "react";
import type { SimpleLines } from "./simple-load";

export interface SimpleValue { lines: SimpleLines; asOf: string }
const Ctx = createContext<SimpleValue>({ lines: { sales: [], expenses: [], full: true }, asOf: "1970-01-01" });

/** A Simple company's lines and today's date (in its time zone), loaded once by the Overview's layout. */
export function SimpleProvider({ value, children }: { value: SimpleValue; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useSimpleLines = () => useContext(Ctx);
