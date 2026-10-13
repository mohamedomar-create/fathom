import { DataSetup } from "@/components/setup/data-setup";
import { loadSales } from "@/lib/company/sales-load";

export default async function DataSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DataSetup sales={await loadSales(id)} />;
}
