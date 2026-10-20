"use client";
import { useMemo } from "react";
import type { ExpensesData } from "@/lib/engine";
import { inventoryLedger, inventoryTieOuts, tieSummary } from "@/lib/engine/inventory";
import { useInventoryData } from "@/lib/company/inventory-context";
import type { InventoryState } from "@/lib/company/inventory-wire";
import { useCompany } from "@/lib/company/context";
import { TieTable } from "./common";
import type { TieOut } from "@/lib/engine/tieout";

/** Data health: every stock check against the accounts over the last 12 months with stock records (the same checks as the Inventory pages). */
export function StockChecks({ inventory: state, expenses }: { inventory: InventoryState; expenses: ExpensesData | null }) {
  const c = useCompany();
  const inventory = useInventoryData(state);
  const ties = useMemo(() => inventoryTieOuts(inventory, inventoryLedger(c.months, expenses ?? { suppliers: [] }, c.accounts), c.settings.fyStartMonth, 12, c.inventorySettings?.locationTypes), [inventory, expenses, c.months, c.accounts, c.settings.fyStartMonth, c.inventorySettings]);
  return <StockTies ties={ties} />;
}

/** The stock checks from results worked out on the server (the stock summary itself never goes to the page). */
export function StockTies({ ties }: { ties: TieOut[] }) {
  const c = useCompany();
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
