"use client";
import { useMemo } from "react";
import type { ExpensesData } from "@/lib/engine";
import { inventoryLedger, inventoryTieOuts, tieSummary, type InventoryData } from "@/lib/engine/inventory";
import { useCompany } from "@/lib/company/context";
import { TieTable } from "./common";

/** Data health: every stock check against the accounts over the last 12 months with stock records (the same checks as the Inventory pages). */
export function StockChecks({ inventory, expenses }: { inventory: InventoryData; expenses: ExpensesData | null }) {
  const c = useCompany();
  const ties = useMemo(() => inventoryTieOuts(inventory, inventoryLedger(c.months, expenses ?? { suppliers: [] }), c.settings.fyStartMonth), [inventory, expenses, c.months, c.settings.fyStartMonth]);
  if (!ties.length) return null;
  const sum = tieSummary(ties), off = sum.off.length, checked = sum.checked;
  return (
    <section className="mt-10" data-testid="stock-checks">
      <h2 className="mb-1 text-lg font-medium">Stock against the accounts</h2>
      <p className="mb-3 text-[13px] text-mute">
        {checked ? `${sum.agreed} of ${checked} checks against the accounts agree.` : "Upload your General Ledger for the same months to check stock against the accounts."}{off ? ` ${off} check${off === 1 ? "" : "s"} differ: each lists the documents behind it.` : ""}
      </p>
      <TieTable tieouts={ties} cur={c.settings.currency} />
    </section>
  );
}
