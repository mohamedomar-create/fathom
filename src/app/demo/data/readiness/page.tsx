import { ReadinessOverview } from "@/components/setup/readiness-overview";
import { demoSales } from "@/lib/company/demo-sales";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { demoInventoryState } from "@/lib/company/demo-inventory";
import { demoPayments } from "@/lib/company/demo-payments";

export default function DemoDataReadiness() {
  return <ReadinessOverview sales={demoSales()} expenses={demoExpenses()} inventory={demoInventoryState()} payments={{ data: demoPayments(), control: {} }} />;
}
