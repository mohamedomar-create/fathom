import { Suspense } from "react";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyBundle } from "@/lib/company/load";
import { loadCompanyMeta } from "@/lib/company/meta";
import { loadDataFacts } from "@/lib/company/data-facts";
import { loadSales, noSales } from "@/lib/company/sales-load";
import { loadExpenses, noExpenses } from "@/lib/company/expenses-load";
import { loadInventory } from "@/lib/company/inventory-load";
import { loadPayments, noPayments } from "@/lib/company/payments-load";
import { unknownState } from "@/lib/company/loaded";
import type { StepId } from "@/lib/company/data-steps";
import { fromWire } from "@/lib/company/inventory-wire";
import { subLedgerStatus } from "@/lib/company/data-status";
import { DataSteps, type DataFacts } from "@/components/data/data-steps";

/** The sub-ledger checks need every summary: they arrive after the steps, which show at once. */
async function WithSubLedgers({ id, facts }: { id: string; facts: DataFacts }) {
  const [c, sales, expenses, inventory, payments] = await Promise.all([loadCompanyBundle(id), loadSales(id), loadExpenses(id), loadInventory(id), loadPayments(id)]);
  // The sub-ledger checks run here; the page gets their result, not the data behind them.
  const sub = subLedgerStatus({
    months: c.months, checks: [], fyStart: c.settings.fyStartMonth, sales: sales.data, expenses: expenses.data, inventory: inventory?.wire ? fromWire(inventory.wire) : null,
    accounts: c.accounts, locationTypes: c.inventorySettings?.locationTypes, payments: payments.data,
  });
  // A summary that could not be read leaves its step unknown ("couldn't be checked"), never "to do".
  const unread: StepId[] = [
    ...(unknownState(sales, (d) => noSales(d as typeof sales.data)) ? ["sales" as const] : []),
    ...(inventory.error === "LOAD_FAILED" || unknownState(expenses, (d) => noExpenses(d as typeof expenses.data)) ? ["stock" as const] : []),
    ...(unknownState(payments, (d) => noPayments((d as typeof payments.data).data)) ? ["ageing" as const] : []),
  ];
  return <DataSteps facts={facts} sub={{ ...sub, unread }} />;
}

export default async function DataStepsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const meta = await loadCompanyMeta(id);
  const facts = await loadDataFacts(supabase, id, meta.dataVersion);
  return <Suspense fallback={<DataSteps facts={facts} sub={null} />}><WithSubLedgers id={id} facts={facts} /></Suspense>;
}
export const maxDuration = 60;
