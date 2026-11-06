import { Suspense } from "react";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyBundle } from "@/lib/company/load";
import { loadCompanyMeta } from "@/lib/company/meta";
import { loadDataFacts } from "@/lib/company/data-facts";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { loadInventory } from "@/lib/company/inventory-load";
import { loadPayments } from "@/lib/company/payments-load";
import { moduleStates } from "@/lib/company/status";
import { moduleLoads } from "@/lib/company/module-loads";
import { fromWire } from "@/lib/company/inventory-wire";
import { subLedgerStatus } from "@/lib/company/data-status";
import { DataSteps, type DataFacts } from "@/components/data/data-steps";
import { SystemPicker } from "@/components/data/system-picker";
import { IntakeCard } from "@/components/intake/intake-card";
import { AreasMissed } from "@/components/data/areas-missed";
import { ModuleSteps } from "@/components/data/module-steps";

/** The sub-ledger checks need every summary: they arrive after the steps, which show at once. */
async function WithSubLedgers({ id, facts }: { id: string; facts: DataFacts }) {
  const [c, sales, expenses, inventory, payments] = await Promise.all([loadCompanyBundle(id), loadSales(id), loadExpenses(id), loadInventory(id), loadPayments(id)]);
  // The sub-ledger checks run here; the page gets their result, not the data behind them.
  const sub = subLedgerStatus({
    months: c.months, checks: [], fyStart: c.settings.fyStartMonth, sales: sales.data, expenses: expenses.data, inventory: inventory?.wire ? fromWire(inventory.wire) : null,
    accounts: c.accounts, locationTypes: c.inventorySettings?.locationTypes, payments: payments.data,
  });
  // A summary that could not be read leaves its step unknown ("couldn't be checked"), never "to do".
  const { unread, pending } = moduleStates(moduleLoads(sales, expenses, payments, inventory));
  return <DataSteps facts={facts} sub={{ ...sub, unread, pending }} />;
}

export default async function DataStepsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ areas_missed?: string }> }) {
  const { id } = await params;
  const { areas_missed } = await searchParams;
  const missed = (areas_missed ?? "").split(",").filter((k) => /^[a-z][a-z0-9_]{1,39}$/.test(k)).slice(0, 20);
  const { supabase } = await getUser();
  const meta = await loadCompanyMeta(id);
  const facts = await loadDataFacts(supabase, id, meta.dataVersion);
  return <>{missed.length > 0 && <AreasMissed id={id} keys={missed} />}<SystemPicker /><IntakeCard /><Suspense fallback={<DataSteps facts={facts} sub={null} />}><WithSubLedgers id={id} facts={facts} /></Suspense><ModuleSteps /></>;
}
export const maxDuration = 60;
