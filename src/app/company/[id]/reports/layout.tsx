import { SalesProvider } from "@/lib/company/sales-context";
import { loadSales } from "@/lib/company/sales-load";

/** Reports can include the Sales page, so they read the company's sales too. */
export default async function ReportsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesProvider value={await loadSales(id)}>{children}</SalesProvider>;
}
