import "server-only";
import { cache } from "react";
import { EMPTY_EXPENSES, type ExpensesData } from "@/lib/engine";
import { parseExpenseSummary } from "./expenses-parse";
import { getUser } from "@/lib/supabase/server";
import { summaryStamps } from "./meta";
import { remember } from "./summary-cache";

/** The company's expense lines, added up by supplier and by account per month, with the entries worth a look. */
export const loadExpenses = cache(async (companyId: string): Promise<ExpensesData> => {
  const { supabase } = await getUser();
  // Kept between visits while nothing it is built from changed (the stamp checks the person's membership first).
  const stamp = (await summaryStamps(companyId))["expenses"];
  const { data, error } = await remember("expenses", companyId, stamp, async () => {
    const r = await supabase.rpc("expense_summary", { p_company: companyId });
    if (r.error) throw r.error;
    return r;
  }).catch((e: { message: string; code?: string }) => ({ data: null, error: e }));
  if (error) { console.error("expense_summary", error.message); return EMPTY_EXPENSES; }
  return parseExpenseSummary(data);
});
