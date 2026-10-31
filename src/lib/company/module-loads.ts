import { noSales } from "./sales-load";
import { noExpenses } from "./expenses-load";
import { noPayments } from "./payments-load";
import type { ModuleLoad } from "./status";

type L<T> = { status: ModuleLoad["status"]; data: T };
/** Each module's load state with whether it holds any records, for the status model's moduleStates. */
export function moduleLoads<S, E, P extends { data: unknown }>(sales: L<S>, expenses: L<E>, payments: L<P>, inventory: { error: string | null; pending: boolean; wire: unknown }) {
  return {
    sales: { status: sales.status, empty: noSales(sales.data as Parameters<typeof noSales>[0]) },
    expenses: { status: expenses.status, empty: noExpenses(expenses.data as Parameters<typeof noExpenses>[0]) },
    payments: { status: payments.status, empty: noPayments(payments.data.data as Parameters<typeof noPayments>[0]) },
    inventory,
  };
}
