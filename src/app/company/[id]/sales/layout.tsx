import { SalesProvider } from "@/lib/company/sales-context";
import { loadSales, noSales } from "@/lib/company/sales-load";
import { ModuleGate } from "@/components/shell/module-state";
import { statusOf } from "@/lib/company/loaded";

export default async function SalesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sales = await loadSales(id);
  // A failed read shows as failed (with a retry), never as "no sales loaded".
  return <ModuleGate module="sales" state={statusOf(sales, !noSales(sales.data))}><SalesProvider value={sales.data}>{children}</SalesProvider></ModuleGate>;
}
