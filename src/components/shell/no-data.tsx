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
  if (c.months.length || path.includes("/settings") || path.includes("/reports") || /\/(data|sales|expenses|inventory|payments)(\/|$)/.test(path) || /\/planning\/?$/.test(path)) return <>{children}</>;
  // Say what this page will show, so an empty page still explains itself.
  const seg = path.split("/").filter(Boolean)[2] ?? "summary";
  const page = d.noData.pages[seg];
  return (
    <div className="mx-auto max-w-lg py-24 text-center" data-testid="no-data">
      <DatabaseZap className="mx-auto mb-4 h-12 w-12 text-brand" strokeWidth={1.4} />
      {page && <p className="mb-2 text-[15px] font-medium text-ink-2" data-testid="no-data-page">{page}</p>}
      <h1 className="text-2xl font-light">{d.noData.title}</h1>
      <p className="mt-2 text-mute">{c.system && c.system !== "odoo" ? d.noData.bodyOther(c.name) : d.noData.body(c.name)}</p>
      <Link href={`${c.basePath}/data`} className="mt-6 inline-block rounded bg-brand-d px-5 py-2.5 font-medium text-white">{d.noData.add}</Link>
    </div>
  );
}
