import { DataSetup } from "@/components/setup/data-setup";
import { demoSales } from "@/lib/company/demo-sales";
import { demoExpenses } from "@/lib/company/demo-expenses";

export default function DemoDataSetupPage() {
  return <DataSetup sales={demoSales()} expenses={demoExpenses()} />;
}
