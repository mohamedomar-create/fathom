import { DataSetup } from "@/components/setup/data-setup";
import { demoSales } from "@/lib/company/demo-sales";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { demoInventoryState } from "@/lib/company/demo-inventory";

export default function DemoDataSetupPage() {
  return <DataSetup sales={demoSales()} expenses={demoExpenses()} inventory={demoInventoryState()} />;
}
