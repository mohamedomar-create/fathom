import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyBundle } from "@/lib/company/load";
import { loadSales } from "@/lib/company/sales-load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { loadPayments } from "@/lib/company/payments-load";
import { loadInventory } from "@/lib/company/inventory-load";
import { fromWire } from "@/lib/company/inventory-wire";
import { moduleOverview } from "@/lib/company/module-overview";
import { MODULES } from "@/lib/modules/registry";
import { customDefs, isOn, mayView } from "@/lib/modules/company";
import type { PeriodTotal } from "@/lib/modules/view";
import { ModulesHome } from "@/components/modules/modules-home";

/** With the books loaded the home is the executive summary; without them, every module that holds data, on its own. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await loadCompanyBundle(id);
  const rows = c.modules ?? [];
  // Financials turned off: the home is the modules, even when books are stored.
  if (c.months.length && isOn("financials", rows)) redirect(`/company/${id}/summary`);
  const { supabase } = await getUser();
  // Only the modules the company has open and the person may see are read.
  const generic = [...MODULES, ...customDefs(rows)].filter((m) => m.storage === "generic" && isOn(m.key, rows) && mayView(m.key, rows, c.role ?? "viewer", c.userId));
  const [sales, expenses, payments, inventory, ...sums] = await Promise.all([
    loadSales(id), loadExpenses(id), loadPayments(id), loadInventory(id),
    ...generic.map((m) => supabase.rpc("module_summary", { p_company: id, p_module: m.key })),
  ]);
  const cards = moduleOverview({
    sales: sales.data, expenses: expenses.data, payments: payments.data.data, stockMonths: inventory.wire ? fromWire(inventory.wire).moves.months : [],
    // A summary that couldn't be read leaves its module off the home, never shown as empty figures.
    generic: generic.map((m, i) => ({ key: m.key, periods: ((sums[i].data as { periods?: PeriodTotal[] } | null)?.periods) ?? [] })),
  });
  return <ModulesHome cards={cards} />;
}
export const maxDuration = 60;
