"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DatabaseZap } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { useDict } from "@/lib/i18n/context";

/** Analysis pages need at least one month of data; show the next step instead of an empty page. */
export function NoDataGate({ children }: { children: React.ReactNode }) {
  const c = useCompany();
  const d = useDict();
  const path = usePathname();
  // The Sales, Expenses, Inventory and Payments pages explain for themselves what to upload.
  if (c.months.length || path.includes("/settings") || path.includes("/reports") || /\/(sales|expenses|inventory|payments)(\/|$)/.test(path)) return <>{children}</>;
  return (
    <div className="mx-auto max-w-lg py-24 text-center">
      <DatabaseZap className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      <h1 className="text-2xl font-light">{d.noData.title}</h1>
      <p className="mt-2 text-mute">{d.noData.body(c.name)}</p>
      <Link href={`${c.basePath}/settings/source-data`} className="mt-6 inline-block rounded bg-brand-d px-5 py-2.5 font-medium text-white">{d.noData.add}</Link>
    </div>
  );
}
