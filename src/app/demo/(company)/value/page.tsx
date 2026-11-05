import type { Metadata } from "next";
import { ValueView } from "@/components/value/value-view";

export const metadata: Metadata = { title: "Company value" };

export default function Page() {
  return <ValueView tab="overview" demo saved={{ purpose: "owner", sector: "medical", fx: 50 }} topCustomerShare={0.18} />;
}
