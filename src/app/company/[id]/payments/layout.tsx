import { PaymentsProvider } from "@/lib/company/payments-context";
import { loadPayments } from "@/lib/company/payments-load";

export default async function PaymentsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PaymentsProvider value={await loadPayments(id)}>{children}</PaymentsProvider>;
}
