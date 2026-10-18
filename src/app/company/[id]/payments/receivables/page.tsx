import type { Metadata } from "next";
import { AgeingPage } from "@/components/payments/payments-pages";
export const metadata: Metadata = { title: "Receivables" };
export default function Page() { return <AgeingPage side="receivable" />; }
