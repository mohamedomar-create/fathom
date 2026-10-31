import { loadCompanyBundle } from "@/lib/company/load";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses, noExpenses } from "@/lib/company/expenses-load";
import { loadInventory } from "@/lib/company/inventory-load";
import { loadPayments } from "@/lib/company/payments-load";
import { moduleStates } from "@/lib/company/status";
import { moduleLoads } from "@/lib/company/module-loads";
import { unknownState } from "@/lib/company/loaded";
import type { ReadinessSector } from "@/lib/company/readiness";
import { fromWire } from "@/lib/company/inventory-wire";
import { readiness } from "@/lib/company/readiness";
import { runChecks } from "@/lib/company/checks";
import { dataMapRows } from "@/lib/company/data-map";
import { ReadinessView } from "@/components/setup/readiness-overview";

export default async function DataReadinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [c, sales, expenses, inventory, payments] = await Promise.all([loadCompanyBundle(id), loadSales(id), loadExpenses(id), loadInventory(id), loadPayments(id)]);
  // Worked out here: the page gets each sector's readiness and the data map, not the summaries behind them.
  // The same module states as the Data steps (status.ts): unread is unknown, pending is still adding up; neither is "missing".
  const m = moduleStates(moduleLoads(sales, expenses, payments, inventory));
  const SECTOR = { sales: "sales", stock: "inventory", ageing: "payments" } as const;
  const unread: ReadinessSector[] = [...m.unread.map((k) => SECTOR[k]), ...(expenses.status === "failed" ? ["expenses" as const] : [])];
  const pending: ReadinessSector[] = [...m.pending.map((k) => SECTOR[k]), ...(unknownState(expenses, (d) => noExpenses(d as typeof expenses.data)) && expenses.status === "pending" ? ["expenses" as const] : [])];
  const all = readiness({
    months: c.months, unit: c.unit, checks: runChecks({ accounts: c.accounts, months: c.months, unit: c.unit }), fyStart: c.settings.fyStartMonth,
    sales: sales.data, expenses: expenses.data, inventory: inventory?.wire ? fromWire(inventory.wire) : null, accounts: c.accounts, locationTypes: c.inventorySettings?.locationTypes,
    assumptions: c.assumptions, forecast: c.forecast, booksFromZero: c.booksFromZero, payments: payments.data, unread, pending,
  });
  return <ReadinessView all={all} rows={dataMapRows(c.months, sales.data, expenses.data)} />;
}
export const maxDuration = 60;
