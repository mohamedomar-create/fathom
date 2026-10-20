import { loadCompanyBundle } from "@/lib/company/load";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { loadInventory } from "@/lib/company/inventory-load";
import { loadPayments } from "@/lib/company/payments-load";
import { fromWire } from "@/lib/company/inventory-wire";
import { readiness } from "@/lib/company/readiness";
import { runChecks } from "@/lib/company/checks";
import { dataMapRows } from "@/lib/company/data-map";
import { ReadinessView } from "@/components/setup/readiness-overview";

export default async function DataReadinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, sales, expenses, inventory, payments] = await Promise.all([loadCompanyBundle(id), loadSales(id), loadExpenses(id), loadInventory(id), loadPayments(id)]);
  // Worked out here: the page gets each sector's readiness and the data map, not the summaries behind them.
  const all = readiness({
    months: c.months, checks: runChecks({ accounts: c.accounts, months: c.months }), fyStart: c.settings.fyStartMonth,
    sales, expenses, inventory: inventory?.wire ? fromWire(inventory.wire) : null, accounts: c.accounts, locationTypes: c.inventorySettings?.locationTypes,
    assumptions: c.assumptions, forecast: c.forecast, booksFromZero: c.booksFromZero, payments: payments ?? undefined,
  });
  return <ReadinessView all={all} rows={dataMapRows(c.months, sales, expenses)} />;
}
export const maxDuration = 60;
