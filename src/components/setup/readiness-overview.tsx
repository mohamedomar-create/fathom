"use client";
import { useCompany } from "@/lib/company/context";
import { mlabel, type ExpensesData, type SalesData } from "@/lib/engine";
import { useInventoryData } from "@/lib/company/inventory-context";
import type { InventoryState } from "@/lib/company/inventory-wire";
import type { PaymentsBundle } from "@/lib/company/payments-load";
import { SectorPanel, TemplateButton, useReadiness } from "./readiness-view";
import { DataMap } from "./data-map";

/**
 * Below the Data steps: what each upload feeds (the data map), each sector's readiness (what is loaded and how much of it
 * checks out), and the templates for companies without Odoo.
 */
export function ReadinessOverview({ sales, expenses = null, inventory: state = null, payments = null }: { sales: SalesData | null; expenses?: ExpensesData | null; inventory?: InventoryState | null; payments?: PaymentsBundle | null }) {
  const parsed = useInventoryData(state);
  const inventory = state ? parsed : null;
  const c = useCompany();
  const all = useReadiness(sales, expenses, inventory, payments);
  const latest = [...c.months].map((m) => m.period).sort().pop();
  return (
    <div className="mt-10" data-testid="readiness-overview">
      <DataMap months={c.months} sales={sales} expenses={expenses} />
      <h2 className="mb-1 text-xl font-light">How ready is your data?</h2>
      <p className="mb-4 text-sm text-mute">Teal: what you have. Orange: how much of it checks out.{latest ? ` Latest month: ${mlabel(latest)}.` : ""}</p>
      <div className="space-y-5">{all.map((r) => <SectorPanel key={r.key} r={r} basePath={c.basePath} />)}</div>
      <h2 className="mb-2 mt-8 text-xl font-light">No Odoo? Use our templates</h2>
      <div className="flex flex-wrap gap-2" data-testid="templates">
        {(["opening", "financials", "sales", "expenses"] as const).map((k) => <TemplateButton key={k} kind={k} compact />)}
      </div>
    </div>
  );
}
