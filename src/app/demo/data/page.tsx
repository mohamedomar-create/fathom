import { DataSteps } from "@/components/data/data-steps";
import { demoCompany } from "@/lib/company/demo";
import { demoSales } from "@/lib/company/demo-sales";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { demoInventoryState } from "@/lib/company/demo-inventory";
import { demoPayments } from "@/lib/company/demo-payments";
import { fromWire } from "@/lib/company/inventory-wire";
import { subLedgerStatus } from "@/lib/company/data-status";

export default function DemoDataSteps() {
  // The demo's books stand for a General Ledger upload with its own opening balances; no Trial Balance check kept yet.
  const facts = { ledger: true, odoo: false, openingInLedger: true, booksStart: null, openingAsAt: null, tbCheck: null, accepted: [] };
  const c = demoCompany(), inv = demoInventoryState();
  const sub = subLedgerStatus({ months: c.months, checks: [], fyStart: c.settings.fyStartMonth, sales: demoSales(), expenses: demoExpenses(), inventory: inv?.wire ? fromWire(inv.wire) : null, accounts: c.accounts, payments: { data: demoPayments(), control: {} } });
  return <DataSteps facts={facts} sub={sub} />;
}
