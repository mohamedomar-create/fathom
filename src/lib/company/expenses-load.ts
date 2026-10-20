import "server-only";
import { cache } from "react";
import { EMPTY_EXPENSES, type ExpensesData } from "@/lib/engine";
import { parseExpenseSummary } from "./expenses-parse";
import { loadKept } from "./summary-load";
import type { Loaded } from "./loaded";

export const noExpenses = (d: ExpensesData) => d.suppliers.length === 0 && d.accounts.length === 0;

/** The company's expense lines, added up by supplier and by account per month, with the entries worth a look. */
export const loadExpenses = cache((companyId: string): Promise<Loaded<ExpensesData>> => loadKept("expenses", companyId, parseExpenseSummary, EMPTY_EXPENSES, noExpenses));
