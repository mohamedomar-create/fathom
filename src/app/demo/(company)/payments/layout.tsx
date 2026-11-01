import { PaymentsProvider } from "@/lib/company/payments-context";
import { demoPayments } from "@/lib/company/demo-payments";

export default function DemoPaymentsLayout({ children }: { children: React.ReactNode }) {
  return <PaymentsProvider value={{ data: demoPayments(), control: {} }}>{children}</PaymentsProvider>;
}
