import { CashUpload } from "@/components/cash/cash-upload";
import { loadCashUploads } from "@/lib/cash/load";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CashUpload uploads={await loadCashUploads(id)} />;
}
export const maxDuration = 60;
