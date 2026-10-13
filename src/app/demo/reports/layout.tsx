import { SalesProvider } from "@/lib/company/sales-context";
import { demoSales } from "@/lib/company/demo-sales";

export default function DemoReportsLayout({ children }: { children: React.ReactNode }) {
  return <SalesProvider value={demoSales()}>{children}</SalesProvider>;
}
