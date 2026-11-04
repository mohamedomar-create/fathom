"use client";
import { createContext, useContext, useMemo } from "react";
import { unpack, type Packed } from "@/lib/wire/pack";
import { EMPTY_PAYMENTS } from "@/lib/engine/payments";
import type { PaymentsBundle } from "./payments-load";

const Ctx = createContext<PaymentsBundle>({ data: EMPTY_PAYMENTS, control: {} });

/** The company's ageing reports and payments for the Payments pages (loaded once by the sector's layout). */
export function PaymentsProvider({ value, children }: { value: PaymentsBundle | Packed; children: React.ReactNode }) {
  // Sent compact (lib/wire/pack); read back once here.
  const data = useMemo(() => unpack<PaymentsBundle>(value), [value]);
  return <Ctx.Provider value={data}>{children}</Ctx.Provider>;
}

export const usePayments = () => useContext(Ctx);
