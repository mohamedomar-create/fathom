import "server-only";
import { cache } from "react";
import { EMPTY_PAYMENTS, type PaymentsData } from "@/lib/engine/payments";
import { parsePaymentsSummary } from "./payments-parse";
import { controlAccountsOf } from "./time-zone";
import { loadCompanyMeta } from "./meta";
import { loadKept } from "./summary-load";
import type { Loaded } from "./loaded";

export interface PaymentsBundle { data: PaymentsData; control: { receivable?: string[]; payable?: string[] } }

export const noPayments = (d: PaymentsData) => d.payments.length === 0 && Object.keys(d.aged).length === 0;

/** The company's latest ageing reports and its payments, with whether they could be read, and the control accounts it chose. */
export const loadPayments = cache(async (companyId: string): Promise<Loaded<PaymentsBundle>> => {
  const [state, meta] = await Promise.all([loadKept("payments", companyId, parsePaymentsSummary, EMPTY_PAYMENTS, noPayments), loadCompanyMeta(companyId)]);
  return { ...state, data: { data: state.data, control: controlAccountsOf(meta.kpiConfig) } };
});
