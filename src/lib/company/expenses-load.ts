import "server-only";
import { cache } from "react";
import { EMPTY_EXPENSES, type ExpensesData } from "@/lib/engine";
import { parseExpenseSummary } from "./expenses-parse";
import { getUser } from "@/lib/supabase/server";

/** The company's expense lines, added up by supplier and by account per month, with the entries worth a look. */
export const loadExpenses = cache(async (companyId: string): Promise<ExpensesData> => {
  const { supabase } = await getUser();
  const { data, error } = await supabase.rpc("expense_summary", { p_company: companyId });
  if (error) { console.error("expense_summary", error.message); return EMPTY_EXPENSES; }
  return parseExpenseSummary(data);
});
