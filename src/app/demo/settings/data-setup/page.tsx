import { DataSetup } from "@/components/setup/data-setup";
import { demoSales } from "@/lib/company/demo-sales";

export default function DemoDataSetupPage() {
  return <DataSetup sales={demoSales()} />;
}
