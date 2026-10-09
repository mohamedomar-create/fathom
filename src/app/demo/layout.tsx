import type { Metadata } from "next";
import { CompanyShell } from "@/components/shell/company-shell";
import { demoCompany } from "@/lib/company/demo";

export const metadata: Metadata = { title: "Demo company" };

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <CompanyShell company={demoCompany()}>{children}</CompanyShell>;
}
