import { DataSteps } from "@/components/data/data-steps";
import { ReadinessOverview } from "@/components/setup/readiness-overview";
import { demoSales } from "@/lib/company/demo-sales";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { demoInventoryState } from "@/lib/company/demo-inventory";
import { demoPayments } from "@/lib/company/demo-payments";

export default function DemoDataSteps() {
  // The demo's books stand for a General Ledger upload with its own opening balances; no Trial Balance check kept yet.
  const facts = { ledger: true, odoo: false, openingInLedger: true, booksStart: null, openingAsAt: null, tbCheck: null, accepted: [] };
  const payments = { data: demoPayments(), control: {} };
  return (
    <>
      <DataSteps facts={facts} sales={demoSales()} expenses={demoExpenses()} inventory={demoInventoryState()} payments={payments} />
      <ReadinessOverview sales={demoSales()} expenses={demoExpenses()} inventory={demoInventoryState()} payments={payments} />
    </>
  );
}
