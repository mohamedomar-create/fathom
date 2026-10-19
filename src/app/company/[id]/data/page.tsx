import { getUser } from "@/lib/supabase/server";
import { loadCompanyBundle } from "@/lib/company/load";
import { loadDataFacts } from "@/lib/company/data-facts";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { loadInventory } from "@/lib/company/inventory-load";
import { loadPayments } from "@/lib/company/payments-load";
import { fromWire } from "@/lib/company/inventory-wire";
import { subLedgerStatus } from "@/lib/company/data-status";
import { DataSteps } from "@/components/data/data-steps";

export default async function DataStepsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const c = await loadCompanyBundle(id);
  const [facts, sales, expenses, inventory, payments] = await Promise.all([loadDataFacts(supabase, id, c.dataVersion), loadSales(id), loadExpenses(id), loadInventory(id), loadPayments(id)]);
  // The sub-ledger checks run here; the page gets their result, not the data behind them.
  const sub = subLedgerStatus({
    months: c.months, checks: [], fyStart: c.settings.fyStartMonth, sales, expenses, inventory: inventory?.wire ? fromWire(inventory.wire) : null,
    accounts: c.accounts, locationTypes: c.inventorySettings?.locationTypes, payments: payments ?? undefined,
  });
  return <DataSteps facts={facts} sub={sub} />;
}
export const maxDuration = 60;
