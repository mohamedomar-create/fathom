"use client";
import Link from "next/link";
import { useCompany } from "@/lib/company/context";
import { SectorPanel, useReadiness } from "./readiness-view";

/** Shown right after an import: how complete and accurate the financial data now is, and what to do next. */
export function ImportReadiness() {
  const c = useCompany();
  const fin = useReadiness(null).find((r) => r.key === "financials")!;
  return (
    <div className="mb-8" data-testid="import-readiness">
      <h2 className="mb-1 text-xl font-light">Data accuracy result</h2>
      <p className="mb-3 text-sm text-mute">What this import gives the Financials sector, checked item by item. Anything below 100% says exactly what to upload next. <Link href={`${c.basePath}/settings/data-setup`} className="text-brand-d underline">All sectors</Link></p>
      <SectorPanel r={fin} basePath={c.basePath} />
    </div>
  );
}
