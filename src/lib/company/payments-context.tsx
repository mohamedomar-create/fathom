"use client";
import { createContext, useContext } from "react";
import { EMPTY_PAYMENTS } from "@/lib/engine/payments";
import type { PaymentsBundle } from "./payments-load";

const Ctx = createContext<PaymentsBundle>({ data: EMPTY_PAYMENTS, control: {} });

/** The company's ageing reports and payments for the Payments pages (loaded once by the sector's layout). */
export function PaymentsProvider({ value, children }: { value: PaymentsBundle; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePayments = () => useContext(Ctx);
