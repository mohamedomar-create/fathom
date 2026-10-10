"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DatabaseZap } from "lucide-react";
import { useCompany } from "@/lib/company/context";

/** Analysis pages need at least one month of data; show the next step instead of an empty page. */
export function NoDataGate({ children }: { children: React.ReactNode }) {
  const c = useCompany();
  const path = usePathname();
  if (c.months.length || path.includes("/settings") || path.includes("/reports")) return <>{children}</>;
  return (
    <div className="mx-auto max-w-lg py-24 text-center">
      <DatabaseZap className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      <h2 className="text-2xl font-light">No financial data yet</h2>
      <p className="mt-2 text-mute">Upload an Odoo export or connect your Odoo database to see KPIs, breakeven, cash flow and more for {c.name}.</p>
      <Link href={`${c.basePath}/settings/source-data`} className="mt-6 inline-block rounded bg-brand-d px-5 py-2.5 font-medium text-white">Add financial data</Link>
    </div>
  );
}
