import { PaymentsProvider } from "@/lib/company/payments-context";
import { loadPayments, noPayments } from "@/lib/company/payments-load";
import { ModuleGate, statusOf } from "@/components/shell/module-state";

export default async function PaymentsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payments = await loadPayments(id);
  return <ModuleGate module="payments" state={statusOf(payments, !noPayments(payments.data.data))}><PaymentsProvider value={payments.data}>{children}</PaymentsProvider></ModuleGate>;
}
