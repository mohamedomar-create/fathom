import type { Metadata } from "next";
import { PaymentsOverview } from "@/components/payments/payments-pages";
export const metadata: Metadata = { title: "Payments Overview" };
export default function Page() { return <PaymentsOverview />; }
