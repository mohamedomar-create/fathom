import "server-only";
import { cache } from "react";
import { EMPTY_PAYMENTS, type PaymentsData } from "@/lib/engine/payments";
import { parsePaymentsSummary } from "./payments-parse";
import { controlAccountsOf } from "./time-zone";
import { getUser } from "@/lib/supabase/server";

export interface PaymentsBundle { data: PaymentsData; control: { receivable?: string[]; payable?: string[] } }

/** The company's latest ageing reports and its payments, in one checked call, with the control accounts it chose. */
export const loadPayments = cache(async (companyId: string): Promise<PaymentsBundle> => {
  const { supabase } = await getUser();
  const [{ data, error }, { data: c }] = await Promise.all([
    supabase.rpc("payments_summary", { p_company: companyId }),
    supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle(),
  ]);
  if (error) { if (error.code !== "PGRST202") console.error("payments_summary", error.message); return { data: EMPTY_PAYMENTS, control: controlAccountsOf(c?.kpi_config) }; }
  return { data: parsePaymentsSummary(data), control: controlAccountsOf(c?.kpi_config) };
});
