import type { Metadata } from "next";
import { PaymentsFlows } from "@/components/payments/payments-pages";
export const metadata: Metadata = { title: "Payments In and Out" };
export default function Page() { return <PaymentsFlows />; }
