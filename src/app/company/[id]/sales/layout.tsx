import { SalesProvider } from "@/lib/company/sales-context";
import { loadSales } from "@/lib/company/sales-load";

export default async function SalesLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesProvider value={await loadSales(id)}>{children}</SalesProvider>;
}
