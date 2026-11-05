import type { Metadata } from "next";
import { ValueView } from "@/components/value/value-view";

export const metadata: Metadata = { title: "Valuation" };

export default function Page() {
  return <ValueView tab="methods" demo saved={{ purpose: "owner", sector: "medical", fx: 50 }} topCustomerShare={0.18} />;
}
